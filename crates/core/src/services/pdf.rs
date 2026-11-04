//! PDF helpers: page counting and image → PDF (one A4 page per image).

use std::io::Cursor;
use std::path::Path;

use anyhow::Context;
use image::{DynamicImage, ImageDecoder, ImageReader, RgbImage};
use lopdf::content::{Content, Operation};
use lopdf::{Document, Object, Stream, dictionary};

/// Number of pages in a PDF.
pub fn page_count(path: &Path) -> anyhow::Result<u32> {
    match Document::load(path) {
        Ok(doc) => {
            let n = doc.get_pages().len() as u32;
            if n > 0 {
                return Ok(n);
            }
            fallback_count(path)
        }
        Err(e) => fallback_count(path).with_context(|| format!("reading PDF: {e}")),
    }
}

/// Rough count of `/Type /Page` objects for PDFs lopdf can't parse.
fn fallback_count(path: &Path) -> anyhow::Result<u32> {
    let bytes = std::fs::read(path)?;
    if !bytes.starts_with(b"%PDF") {
        anyhow::bail!("not a PDF file");
    }
    let mut count = 0u32;
    let needle = b"/Type";
    let mut i = 0;
    while let Some(pos) = find(&bytes[i..], needle) {
        let mut j = i + pos + needle.len();
        while j < bytes.len() && (bytes[j] as char).is_ascii_whitespace() {
            j += 1;
        }
        if bytes[j..].starts_with(b"/Page") && !bytes[j..].starts_with(b"/Pages") {
            count += 1;
        }
        i = j;
    }
    if count == 0 {
        anyhow::bail!("could not count pages");
    }
    Ok(count)
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

const A4_W: f32 = 595.28;
const A4_H: f32 = 841.89;
const MARGIN: f32 = 18.0;
const MAX_PIXELS: u32 = 4000;
/// Largest image side we will decode at all (a 600 dpi A3 scan is ~10 000 px).
const MAX_DECODE_DIM: u32 = 16_000;
/// Memory cap for decoding one image.
const MAX_DECODE_BYTES: u64 = 768 * 1024 * 1024;

/// Converts any supported image to a single-page A4 PDF (portrait or landscape to match).
pub fn image_to_pdf(src: &Path, dest: &Path) -> anyhow::Result<u32> {
    // Guard against "decompression bombs": tiny files that claim enormous dimensions.
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_DECODE_DIM);
    limits.max_image_height = Some(MAX_DECODE_DIM);
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    let mut reader = ImageReader::open(src)?.with_guessed_format()?;
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .context("unsupported, damaged or too large image")?;
    // Phone photos store rotation in EXIF; apply it so the print isn't sideways.
    let orientation = decoder.orientation().ok();
    let mut img = DynamicImage::from_decoder(decoder).context("decoding image")?;
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    if img.width() > MAX_PIXELS || img.height() > MAX_PIXELS {
        img = img.resize(
            MAX_PIXELS,
            MAX_PIXELS,
            image::imageops::FilterType::Lanczos3,
        );
    }
    let rgb = flatten_on_white(&img);
    let (w, h) = (rgb.width(), rgb.height());

    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(Cursor::new(&mut jpeg), 92)
        .encode_image(&rgb)
        .context("encoding image")?;

    let (page_w, page_h) = if w > h { (A4_H, A4_W) } else { (A4_W, A4_H) };
    let scale = ((page_w - 2.0 * MARGIN) / w as f32).min((page_h - 2.0 * MARGIN) / h as f32);
    let (draw_w, draw_h) = (w as f32 * scale, h as f32 * scale);
    let (x, y) = ((page_w - draw_w) / 2.0, (page_h - draw_h) / 2.0);

    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();

    let mut img_stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => w as i64,
            "Height" => h as i64,
            "ColorSpace" => "DeviceRGB",
            "BitsPerComponent" => 8,
            "Filter" => "DCTDecode",
        },
        jpeg,
    );
    img_stream.allows_compression = false;
    let img_id = doc.add_object(img_stream);

    let content = Content {
        operations: vec![
            Operation::new("q", vec![]),
            Operation::new(
                "cm",
                vec![
                    draw_w.into(),
                    0.into(),
                    0.into(),
                    draw_h.into(),
                    x.into(),
                    y.into(),
                ],
            ),
            Operation::new("Do", vec![Object::Name(b"Im0".to_vec())]),
            Operation::new("Q", vec![]),
        ],
    };
    let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode()?));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), page_w.into(), page_h.into()],
        "Contents" => content_id,
        "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => img_id } },
    });
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        }),
    );
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);
    doc.save(dest).context("writing PDF")?;
    Ok(1)
}

/// Transparent areas become white paper, not black.
fn flatten_on_white(img: &DynamicImage) -> RgbImage {
    if !img.color().has_alpha() {
        return img.to_rgb8();
    }
    let rgba = img.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let p = rgba.get_pixel(x, y).0;
        let a = p[3] as u32;
        let blend = |c: u8| ((c as u32 * a + 255 * (255 - a)) / 255) as u8;
        image::Rgb([blend(p[0]), blend(p[1]), blend(p[2])])
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_becomes_one_page_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("wide.png");
        image::RgbaImage::from_fn(300, 200, |x, _| image::Rgba([x as u8, 0, 0, 128]))
            .save(&src)
            .unwrap();
        let dest = dir.path().join("wide.pdf");
        assert_eq!(image_to_pdf(&src, &dest).unwrap(), 1);
        assert_eq!(page_count(&dest).unwrap(), 1);
        let doc = Document::load(&dest).unwrap();
        let (_, page) = doc.get_pages().into_iter().next().unwrap();
        let mb = doc.get_dictionary(page).unwrap().get(b"MediaBox").unwrap();
        let w = mb.as_array().unwrap()[2].as_float().unwrap();
        assert!(w > 800.0, "wide image should give a landscape page");
    }

    #[test]
    fn oversized_image_is_rejected_not_decoded() {
        let dir = tempfile::tempdir().unwrap();
        // A valid PNG header claiming 100 000 × 100 000 pixels.
        let src = dir.path().join("bomb.png");
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        let ihdr = [
            &100_000u32.to_be_bytes()[..],
            &100_000u32.to_be_bytes()[..],
            &[8, 2, 0, 0, 0],
        ]
        .concat();
        let mut chunk = b"IHDR".to_vec();
        chunk.extend_from_slice(&ihdr);
        png.extend_from_slice(&(ihdr.len() as u32).to_be_bytes());
        png.extend_from_slice(&chunk);
        png.extend_from_slice(&crc32(&chunk).to_be_bytes());
        std::fs::write(&src, png).unwrap();
        assert!(image_to_pdf(&src, &dir.path().join("out.pdf")).is_err());
    }

    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xFFFF_FFFFu32;
        for &b in data {
            crc ^= b as u32;
            for _ in 0..8 {
                crc = if crc & 1 != 0 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }

    #[test]
    fn garbage_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.pdf");
        std::fs::write(&p, b"hello").unwrap();
        assert!(page_count(&p).is_err());
    }
}
