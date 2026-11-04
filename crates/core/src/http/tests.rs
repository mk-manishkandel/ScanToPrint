use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

use crate::config::Config;
use crate::state::AppState;

pub(crate) async fn test_app() -> (axum::Router, tempfile::TempDir) {
    let (app, _, dir) = test_app_with_state().await;
    (app, dir)
}

pub(crate) async fn test_app_with_state() -> (axum::Router, AppState, tempfile::TempDir) {
    test_app_from([127, 0, 0, 1]).await
}

/// App whose every request appears to come from `ip` (e.g. a phone on the shop Wi-Fi).
pub(crate) async fn test_app_from(ip: [u8; 4]) -> (axum::Router, AppState, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let db = crate::db::open_memory().await.unwrap();
    let (state, workers) = AppState::new(db, Config::new(dir.path().to_path_buf(), 0));
    workers.start(&state);
    let app = super::router(state.clone()).layer(axum::extract::connect_info::MockConnectInfo(
        std::net::SocketAddr::from((ip, 5555)),
    ));
    (app, state, dir)
}

pub(crate) struct Resp {
    pub status: StatusCode,
    pub cookie: Option<String>,
    pub json: Value,
}

pub(crate) async fn call(
    app: &axum::Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
    cookie: Option<&str>,
) -> Resp {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c);
    }
    let req = match body {
        Some(b) => req
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(b.to_string())),
        None => req.body(Body::empty()),
    }
    .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let cookie = res
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string());
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Resp {
        status,
        cookie,
        json,
    }
}

/// Runs first-run setup and returns the owner's session cookie.
pub(crate) async fn setup_owner(app: &axum::Router) -> String {
    let r = call(
        app,
        "POST",
        "/api/setup",
        Some(json!({"shop_name":"Test Shop","name":"Owner","username":"owner","password":"secret123"})),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.json);
    r.cookie.unwrap()
}

#[tokio::test]
async fn health_reports_version() {
    let (app, _d) = test_app().await;
    let r = call(&app, "GET", "/api/health", None, None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.json["version"], crate::VERSION);
}

#[tokio::test]
async fn unknown_api_route_is_404_not_spa() {
    let (app, _d) = test_app().await;
    assert_eq!(
        call(&app, "GET", "/api/nope", None, None).await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn setup_runs_once_then_login_works() {
    let (app, _d) = test_app().await;
    let r = call(&app, "GET", "/api/setup/status", None, None).await;
    assert_eq!(r.json["needs_setup"], true);

    let cookie = setup_owner(&app).await;
    let r = call(&app, "GET", "/api/shop", None, None).await;
    assert_eq!(r.json["shop_name"], "Test Shop");

    // Second setup is refused.
    let r = call(
        &app,
        "POST",
        "/api/setup",
        Some(json!({"shop_name":"X","name":"Evil","username":"evil","password":"secret123"})),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::CONFLICT);

    let r = call(&app, "GET", "/api/admin/me", None, Some(&cookie)).await;
    assert_eq!(r.json["username"], "owner");

    let r = call(
        &app,
        "POST",
        "/api/admin/login",
        Some(json!({"username":"OWNER","password":"secret123"})),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(r.cookie.is_some());
}

#[tokio::test]
async fn admin_routes_need_login_and_staff_cannot_change_settings() {
    let (app, _d) = test_app().await;
    assert_eq!(
        call(&app, "GET", "/api/admin/me", None, None).await.status,
        StatusCode::UNAUTHORIZED
    );
    let owner = setup_owner(&app).await;
    let r = call(
        &app,
        "POST",
        "/api/admin/users",
        Some(json!({"name":"Ram","username":"ram","password":"pass12345","role":"staff"})),
        Some(&owner),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.json);

    let staff = call(
        &app,
        "POST",
        "/api/admin/login",
        Some(json!({"username":"ram","password":"pass12345"})),
        None,
    )
    .await
    .cookie
    .unwrap();
    assert_eq!(
        call(&app, "GET", "/api/admin/settings", None, Some(&staff))
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            "/api/admin/settings",
            Some(json!({"shop_name":"Hacked"})),
            Some(&staff)
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn wrong_password_rejected_and_last_owner_protected() {
    let (app, _d) = test_app().await;
    let owner = setup_owner(&app).await;
    let r = call(
        &app,
        "POST",
        "/api/admin/login",
        Some(json!({"username":"owner","password":"nope"})),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    let me = call(&app, "GET", "/api/admin/me", None, Some(&owner)).await;
    let id = me.json["id"].as_i64().unwrap();
    let r = call(
        &app,
        "PATCH",
        &format!("/api/admin/users/{id}"),
        Some(json!({"role":"staff"})),
        Some(&owner),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

// ---------------- customer flow ----------------

fn sample_pdf(dir: &std::path::Path, pages_hint: &str) -> Vec<u8> {
    let png = dir.join(format!("{pages_hint}.png"));
    image::RgbImage::from_pixel(40, 60, image::Rgb([10, 200, 10]))
        .save(&png)
        .unwrap();
    let pdf = dir.join(format!("{pages_hint}.pdf"));
    crate::services::pdf::image_to_pdf(&png, &pdf).unwrap();
    std::fs::read(pdf).unwrap()
}

async fn upload(app: &axum::Router, job: i64, token: &str, files: &[(&str, Vec<u8>)]) -> Resp {
    let boundary = "XBOUNDARYX";
    let mut body = Vec::new();
    for (name, data) in files {
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(data);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    let req = Request::post(format!("/api/jobs/{job}/files"))
        .header("x-job-token", token)
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    Resp {
        status,
        cookie: None,
        json: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
}

async fn new_job(app: &axum::Router) -> (i64, String, String) {
    let r = call(
        app,
        "POST",
        "/api/jobs",
        Some(json!({"customer_name":"Sita","customer_phone":"98000"})),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.json);
    (
        r.json["id"].as_i64().unwrap(),
        r.json["token"].as_str().unwrap().to_string(),
        r.json["code"].as_str().unwrap().to_string(),
    )
}

async fn get_job_as(app: &axum::Router, id: i64, token: &str) -> Resp {
    call(app, "GET", &format!("/api/jobs/{id}?t={token}"), None, None).await
}

async fn wait_converted(app: &axum::Router, id: i64, token: &str) -> Value {
    for _ in 0..100 {
        let j = get_job_as(app, id, token).await.json;
        if j["files"]
            .as_array()
            .unwrap()
            .iter()
            .all(|f| f["conversion_status"] != "pending")
        {
            return j;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!("conversion did not finish");
}

#[tokio::test]
async fn customer_upload_submit_and_staff_sees_it() {
    let (app, dir) = test_app().await;
    let owner = setup_owner(&app).await;
    let (id, token, code) = new_job(&app).await;
    assert!(code.len() == 5 && code.contains('-'), "{code}");

    let pdf = sample_pdf(dir.path(), "a");
    let png = std::fs::read(dir.path().join("a.png")).unwrap();
    let r = upload(&app, id, &token, &[("report.pdf", pdf), ("photo.png", png)]).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.json);
    let job = wait_converted(&app, id, &token).await;
    let files = job["files"].as_array().unwrap();
    assert_eq!(files.len(), 2);
    assert!(
        files
            .iter()
            .all(|f| f["conversion_status"] == "ok" && f["page_count"] == 1)
    );
    assert_eq!(job["total_pages"], 2);

    // Not in the staff queue until submitted.
    let q = call(&app, "GET", "/api/admin/jobs", None, Some(&owner)).await;
    assert_eq!(q.json.as_array().unwrap().len(), 0);

    let r = call(
        &app,
        "POST",
        &format!("/api/jobs/{id}/submit?t={token}"),
        Some(json!({"notes":"2 copies please"})),
        None,
    )
    .await;
    assert_eq!(r.json["status"], "submitted");

    let q = call(&app, "GET", "/api/admin/jobs", None, Some(&owner)).await;
    let list = q.json.as_array().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["notes"], "2 copies please");

    // Staff can download the original and the PDF.
    let fid = files[0]["id"].as_i64().unwrap();
    let r = app
        .clone()
        .oneshot(
            Request::get(format!("/api/admin/files/{fid}/original"))
                .header(header::COOKIE, &owner)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert!(
        r.headers()[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .contains("report.pdf")
    );

    // Can't add files after submitting.
    let r = upload(&app, id, &token, &[("late.pdf", b"%PDF-1.4".to_vec())]).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn job_token_isolation_and_file_rules() {
    let (app, _dir) = test_app().await;
    let (a, token_a, _) = new_job(&app).await;
    let (b, token_b, _) = new_job(&app).await;
    assert_eq!(
        get_job_as(&app, a, &token_b).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get_job_as(&app, b, "nope").await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(&app, "GET", &format!("/api/jobs/{a}"), None, None)
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(get_job_as(&app, a, &token_a).await.status, StatusCode::OK);

    // Executables are refused.
    let r = upload(&app, a, &token_a, &[("virus.exe", b"MZ".to_vec())]).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    // Empty file refused.
    let r = upload(&app, a, &token_a, &[("empty.pdf", vec![])]).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    // A damaged PDF is accepted but marked failed.
    let r = upload(&app, a, &token_a, &[("broken.pdf", b"not a pdf".to_vec())]).await;
    assert_eq!(r.status, StatusCode::OK);
    let j = wait_converted(&app, a, &token_a).await;
    assert_eq!(j["files"][0]["conversion_status"], "failed");
    // Path tricks in names are neutralised.
    let r = upload(&app, a, &token_a, &[("../../evil.txt", b"hi".to_vec())]).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.json["files"][1]["original_name"], "evil.txt");
}

#[tokio::test]
async fn self_print_flow_with_payment_skipped() {
    let (app, state, dir) = test_app_with_state().await;
    let _owner = setup_owner(&app).await;
    sqlx::query(
        "INSERT INTO printers(system_name, display_name, is_active, allow_self_print, supports_duplex, paper_sizes)
         VALUES (?, 'B/W Laser', 1, 1, 1, '[\"A4\"]')",
    )
    .bind(crate::services::printers::MOCK_PRINTER)
    .execute(&state.db)
    .await
    .unwrap();
    sqlx::query("INSERT INTO printers(system_name, display_name, is_active) VALUES ('Office', 'Office only', 1)")
        .execute(&state.db)
        .await
        .unwrap();

    let printers = call(&app, "GET", "/api/printers/available", None, None)
        .await
        .json;
    assert_eq!(
        printers.as_array().unwrap().len(),
        1,
        "only self-print printers are listed"
    );
    let printer_id = printers[0]["id"].as_i64().unwrap();
    assert!(printers[0].get("system_name").is_none());

    let (id, token, _) = new_job(&app).await;
    let pdf = sample_pdf(dir.path(), "p");
    upload(&app, id, &token, &[("doc.pdf", pdf)]).await;
    let job = wait_converted(&app, id, &token).await;
    let fid = job["files"][0]["id"].as_i64().unwrap();

    let body = json!({"printer_id": printer_id, "items":[{"file_id": fid, "page_range":"1", "copies":3, "duplex":false}]});
    let q = call(
        &app,
        "POST",
        &format!("/api/jobs/{id}/quote?t={token}"),
        Some(body.clone()),
        None,
    )
    .await;
    assert_eq!(q.status, StatusCode::OK, "{:?}", q.json);
    assert_eq!(q.json["total_sheets"], 3);
    assert_eq!(q.json["total_price"], 6.0);

    // Colour isn't supported on this printer.
    let bad = json!({"printer_id": printer_id, "items":[{"file_id": fid, "color": true}]});
    let r = call(
        &app,
        "POST",
        &format!("/api/jobs/{id}/quote?t={token}"),
        Some(bad),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    // Page out of range.
    let bad = json!({"printer_id": printer_id, "items":[{"file_id": fid, "page_range": "2"}]});
    let r = call(
        &app,
        "POST",
        &format!("/api/jobs/{id}/quote?t={token}"),
        Some(bad),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    let pay = call(
        &app,
        "POST",
        &format!("/api/jobs/{id}/pay?t={token}"),
        None,
        None,
    )
    .await;
    assert_eq!(pay.json["status"], "skipped");

    let r = call(
        &app,
        "POST",
        &format!("/api/jobs/{id}/self-print?t={token}"),
        Some(body),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.json);
    assert_eq!(r.json["mode"], "self");
    assert_eq!(r.json["payment_status"], "skipped");

    let mut status = String::new();
    for _ in 0..100 {
        status = get_job_as(&app, id, &token).await.json["status"]
            .as_str()
            .unwrap()
            .to_string();
        if status == "done" || status == "failed" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    if cfg!(windows) {
        // No SumatraPDF next to the test binary on CI → recorded as failed, not lost.
        assert_eq!(status, "failed");
    } else {
        assert_eq!(status, "done");
        let mock = dir.path().join("mock-printer");
        let settings: Vec<_> = std::fs::read_dir(mock)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|x| x == "txt"))
            .map(|e| std::fs::read_to_string(e.path()).unwrap())
            .collect();
        assert_eq!(settings.len(), 1);
        assert!(
            settings[0].contains("3x,simplex,monochrome,paper=A4"),
            "{}",
            settings[0]
        );
    }
}

// ---------------- security & robustness regressions ----------------

#[tokio::test]
async fn first_run_setup_only_from_the_shop_pc() {
    let (lan, _, _d) = test_app_from([192, 168, 1, 77]).await;
    let r = call(
        &lan,
        "POST",
        "/api/setup",
        Some(
            json!({"shop_name":"X","name":"Intruder","username":"intruder","password":"secret123"}),
        ),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    let r = call(&lan, "GET", "/api/setup/status", None, None).await;
    assert_eq!(r.json["needs_setup"], true, "no owner was created");
}

#[tokio::test]
async fn short_passwords_rejected() {
    let (app, _d) = test_app().await;
    let r = call(
        &app,
        "POST",
        "/api/setup",
        Some(json!({"shop_name":"S","name":"O","username":"owner","password":"short1"})),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn cross_site_requests_to_staff_api_are_blocked() {
    let (app, _d) = test_app().await;
    let owner = setup_owner(&app).await;
    let req = |origin: &str| {
        Request::post("/api/admin/cleanup")
            .header(header::HOST, "192.168.1.10:8080")
            .header(header::ORIGIN, origin)
            .header(header::COOKIE, &owner)
            .body(Body::empty())
            .unwrap()
    };
    let evil = app
        .clone()
        .oneshot(req("http://evil.example"))
        .await
        .unwrap();
    assert_eq!(evil.status(), StatusCode::FORBIDDEN);
    let same = app
        .clone()
        .oneshot(req("http://192.168.1.10:8080"))
        .await
        .unwrap();
    assert_eq!(same.status(), StatusCode::OK);
}

#[tokio::test]
async fn html_has_security_headers() {
    let (app, _d) = test_app().await;
    let res = app
        .clone()
        .oneshot(Request::get("/admin").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
    if res.status() == StatusCode::OK {
        // Only when the web UI has been built into the binary.
        let csp = res.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(csp.contains("script-src 'self'"));
    }
}

#[tokio::test]
async fn login_is_rate_limited() {
    let (app, _d) = test_app().await;
    setup_owner(&app).await;
    let mut last = StatusCode::OK;
    for _ in 0..11 {
        last = call(
            &app,
            "POST",
            "/api/admin/login",
            Some(json!({"username":"owner","password":"wrong-guess"})),
            None,
        )
        .await
        .status;
    }
    assert_eq!(last, StatusCode::BAD_REQUEST);
    // Even the right password is refused while locked out.
    let r = call(
        &app,
        "POST",
        "/api/admin/login",
        Some(json!({"username":"owner","password":"secret123"})),
        None,
    )
    .await;
    assert!(r.json["error"].as_str().unwrap().contains("Too many"));
}

#[tokio::test]
async fn double_submit_and_double_self_print_happen_once() {
    let (app, state, dir) = test_app_with_state().await;
    setup_owner(&app).await;
    sqlx::query(
        "INSERT INTO printers(system_name, display_name, is_active, allow_self_print) VALUES (?, 'P', 1, 1)",
    )
    .bind(crate::services::printers::MOCK_PRINTER)
    .execute(&state.db)
    .await
    .unwrap();
    let pid: i64 = sqlx::query_scalar("SELECT id FROM printers")
        .fetch_one(&state.db)
        .await
        .unwrap();

    // Self-print twice at the same time.
    let (id, token, _) = new_job(&app).await;
    upload(&app, id, &token, &[("a.pdf", sample_pdf(dir.path(), "d"))]).await;
    let job = wait_converted(&app, id, &token).await;
    let fid = job["files"][0]["id"].as_i64().unwrap();
    let body = json!({"printer_id": pid, "items":[{"file_id": fid}]});
    let uri = format!("/api/jobs/{id}/self-print?t={token}");
    let (a, b) = tokio::join!(
        call(&app, "POST", &uri, Some(body.clone()), None),
        call(&app, "POST", &uri, Some(body.clone()), None)
    );
    let mut statuses = [a.status, b.status];
    statuses.sort();
    assert_eq!(statuses, [StatusCode::OK, StatusCode::CONFLICT]);
    let runs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM print_runs WHERE job_id = ?")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(runs, 1, "printed exactly once");

    // Submit twice.
    let (id2, token2, _) = new_job(&app).await;
    upload(
        &app,
        id2,
        &token2,
        &[("b.pdf", sample_pdf(dir.path(), "e"))],
    )
    .await;
    let uri = format!("/api/jobs/{id2}/submit?t={token2}");
    let first = call(&app, "POST", &uri, Some(json!({})), None).await;
    let second = call(&app, "POST", &uri, Some(json!({})), None).await;
    assert_eq!(first.status, StatusCode::OK);
    assert_eq!(second.status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn re_adding_a_removed_file_never_overwrites_another() {
    let (app, _d) = test_app().await;
    let (id, token, _) = new_job(&app).await;
    let r = upload(
        &app,
        id,
        &token,
        &[("x.txt", b"first".to_vec()), ("y.txt", b"second".to_vec())],
    )
    .await;
    let first = r.json["files"][0]["id"].as_i64().unwrap();
    // Remove the first, then upload a new file with the second's name.
    call(
        &app,
        "DELETE",
        &format!("/api/jobs/{id}/files/{first}?t={token}"),
        None,
        None,
    )
    .await;
    let r = upload(&app, id, &token, &[("y.txt", b"third".to_vec())]).await;
    assert_eq!(r.json["files"].as_array().unwrap().len(), 2);

    let owner = setup_owner(&app).await;
    let mut bodies = Vec::new();
    for f in r.json["files"].as_array().unwrap() {
        let fid = f["id"].as_i64().unwrap();
        let res = app
            .clone()
            .oneshot(
                Request::get(format!("/api/admin/files/{fid}/original"))
                    .header(header::COOKIE, &owner)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        bodies.push(res.into_body().collect().await.unwrap().to_bytes().to_vec());
    }
    assert_eq!(bodies, vec![b"second".to_vec(), b"third".to_vec()]);
}

#[tokio::test]
async fn simultaneous_customers_get_distinct_codes() {
    let (app, _d) = test_app().await;
    let mut handles = Vec::new();
    for _ in 0..8 {
        let app = app.clone();
        handles.push(tokio::spawn(async move { new_job(&app).await.2 }));
    }
    let mut codes = Vec::new();
    for h in handles {
        codes.push(h.await.unwrap());
    }
    let n = codes.len();
    codes.sort();
    codes.dedup();
    assert_eq!(codes.len(), n, "{codes:?}");
}

#[tokio::test]
async fn submit_carries_customer_print_options_to_staff() {
    let (app, state, dir) = test_app_with_state().await;
    let owner = setup_owner(&app).await;
    let (id, token, _) = new_job(&app).await;
    upload(
        &app,
        id,
        &token,
        &[("thesis.pdf", sample_pdf(dir.path(), "t"))],
    )
    .await;
    let job = wait_converted(&app, id, &token).await;
    let fid = job["files"][0]["id"].as_i64().unwrap();
    let pages = job["files"][0]["page_count"].as_i64().unwrap();

    // No printers set up yet: every option is offered.
    let shop = call(&app, "GET", "/api/shop", None, None).await;
    assert_eq!(shop.json["print_options"]["color"], true);

    let item = json!({"file_id": fid, "copies": 2, "color": true, "duplex": true, "paper_size": "A4", "page_range": "1"});
    let est = call(
        &app,
        "POST",
        &format!("/api/jobs/{id}/estimate?t={token}"),
        Some(json!({"items":[item.clone()]})),
        None,
    )
    .await;
    assert_eq!(est.status, StatusCode::OK, "{:?}", est.json);
    assert!(est.json["total_price"].as_f64().unwrap() > 0.0);
    assert!(est.json["printer_id"].is_null());

    let r = call(
        &app,
        "POST",
        &format!("/api/jobs/{id}/submit?t={token}"),
        Some(json!({"notes": "spiral bind", "items": [item]})),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.json);
    assert!(r.json["estimated_price"].as_f64().unwrap() > 0.0);

    // Staff see exactly what was asked for.
    let staff = call(
        &app,
        "GET",
        &format!("/api/admin/jobs/{id}"),
        None,
        Some(&owner),
    )
    .await;
    let req = &staff.json["files"][0]["request"];
    assert_eq!(req["color"], true);
    assert_eq!(req["duplex"], true);
    assert_eq!(req["copies"], 2);
    assert_eq!(req["page_range"], "1");
    let _ = (state, pages);
}

#[tokio::test]
async fn submit_options_respect_what_the_shop_can_print() {
    let (app, state, dir) = test_app_with_state().await;
    setup_owner(&app).await;
    // One active black & white, single-sided printer.
    sqlx::query(
        "INSERT INTO printers(system_name, display_name, is_active) VALUES ('bw', 'BW', 1)",
    )
    .execute(&state.db)
    .await
    .unwrap();
    let shop = call(&app, "GET", "/api/shop", None, None).await;
    assert_eq!(shop.json["print_options"]["color"], false);
    assert_eq!(shop.json["print_options"]["duplex"], false);

    let (id, token, _) = new_job(&app).await;
    upload(&app, id, &token, &[("a.pdf", sample_pdf(dir.path(), "c"))]).await;
    let job = wait_converted(&app, id, &token).await;
    let fid = job["files"][0]["id"].as_i64().unwrap();
    let r = call(
        &app,
        "POST",
        &format!("/api/jobs/{id}/submit?t={token}"),
        Some(json!({"items": [{"file_id": fid, "color": true}]})),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(r.json["error"].as_str().unwrap().contains("Colour"));
    // Not submitted: the customer can fix it and try again.
    let r = call(
        &app,
        "POST",
        &format!("/api/jobs/{id}/submit?t={token}"),
        Some(json!({"items": [{"file_id": fid, "color": false}]})),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
}

#[tokio::test]
async fn customer_can_cancel_until_printing_starts() {
    let (app, dir) = test_app().await;
    let owner = setup_owner(&app).await;
    let send = |id: i64, token: &str| {
        let app = app.clone();
        let token = token.to_string();
        async move {
            call(
                &app,
                "POST",
                &format!("/api/jobs/{id}/submit?t={token}"),
                Some(json!({})),
                None,
            )
            .await
        }
    };
    let cancel = |id: i64, token: &str| {
        let app = app.clone();
        let token = token.to_string();
        async move {
            call(
                &app,
                "POST",
                &format!("/api/jobs/{id}/cancel?t={token}"),
                None,
                None,
            )
            .await
        }
    };

    // Waiting for staff → customer can cancel; staff see it as cancelled.
    let (id, token, _) = new_job(&app).await;
    upload(&app, id, &token, &[("a.pdf", sample_pdf(dir.path(), "a"))]).await;
    wait_converted(&app, id, &token).await;
    assert_eq!(send(id, &token).await.status, StatusCode::OK);
    let (other, other_token, _) = new_job(&app).await;
    assert_eq!(cancel(id, &other_token).await.status, StatusCode::NOT_FOUND);
    let r = cancel(id, &token).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.json);
    assert_eq!(r.json["status"], "cancelled");
    let q = call(
        &app,
        "GET",
        "/api/admin/jobs?view=active",
        None,
        Some(&owner),
    )
    .await;
    assert!(q.json.as_array().unwrap().iter().all(|j| j["id"] != id));
    // A second cancel changes nothing.
    assert_eq!(cancel(id, &token).await.status, StatusCode::CONFLICT);

    // Once staff have printed it (ready), the customer can't cancel.
    upload(
        &app,
        other,
        &other_token,
        &[("b.pdf", sample_pdf(dir.path(), "b"))],
    )
    .await;
    wait_converted(&app, other, &other_token).await;
    send(other, &other_token).await;
    let r = call(
        &app,
        "PATCH",
        &format!("/api/admin/jobs/{other}"),
        Some(json!({"status":"ready"})),
        Some(&owner),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(
        cancel(other, &other_token).await.status,
        StatusCode::CONFLICT
    );
    assert_eq!(
        get_job_as(&app, other, &other_token).await.json["status"],
        "ready"
    );
}
