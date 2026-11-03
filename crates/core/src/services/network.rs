//! The addresses phones can use to reach this PC on the shop Wi-Fi.

use std::net::Ipv4Addr;

pub fn lan_ipv4() -> Vec<Ipv4Addr> {
    let mut ips: Vec<Ipv4Addr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| !i.is_loopback())
        .filter_map(|i| match i.ip() {
            // Some routers hand out non-standard ranges, so accept any usable IPv4.
            std::net::IpAddr::V4(v4)
                if !v4.is_link_local() && !v4.is_unspecified() && !v4.is_multicast() =>
            {
                Some(v4)
            }
            _ => None,
        })
        .collect();
    // Prefer typical home/shop router ranges first.
    ips.sort_by_key(|ip| match ip.octets() {
        [192, 168, ..] => 0,
        [10, ..] => 1,
        _ if ip.is_private() => 2,
        _ => 3,
    });
    ips.dedup();
    ips
}

pub fn portal_urls(port: u16) -> Vec<String> {
    lan_ipv4()
        .into_iter()
        .map(|ip| {
            if port == 80 {
                format!("http://{ip}/")
            } else {
                format!("http://{ip}:{port}/")
            }
        })
        .collect()
}
