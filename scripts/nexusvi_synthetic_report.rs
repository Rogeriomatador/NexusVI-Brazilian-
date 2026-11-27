// SPDX-License-Identifier: GPL-3.0-or-later
//! Fail-closed reader and paired summary of the independent histogram control.
use std::io::{self, Read};

const MAX_INPUT: u64 = 128 * 1024;

#[derive(Debug)]
struct Report {
    items: usize,
    seed: u64,
    samples: Vec<(u64, u64)>,
}

fn field<'a>(s: Option<&'a str>, prefix: &str) -> Result<&'a str, String> {
    s.and_then(|s| s.strip_prefix(prefix))
        .ok_or_else(|| format!("missing {prefix}"))
}

fn parse_number<T: std::str::FromStr>(s: &str) -> Result<T, String> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err("expected unsigned decimal integer".into());
    }
    s.parse().map_err(|_| "integer outside supported range".into())
}

fn parse(input: &str) -> Result<Report, String> {
    let mut lines = input.lines();
    let mut header = lines.next().ok_or("missing metadata")?.split(',');
    if header.next() != Some("workload=histogram16-v1") {
        return Err("unsupported workload".into());
    }
    let items: usize = parse_number(field(header.next(), "items=")?)?;
    let pairs: usize = parse_number(field(header.next(), "pairs=")?)?;
    let seed: u64 = parse_number(field(header.next(), "seed=")?)?;
    if header.next().is_some() || !(1024..=1_048_576).contains(&items)
        || !(20..=1000).contains(&pairs) || items > 16_777_216 / pairs
    {
        return Err("invalid metadata or work budget".into());
    }
    if lines.next() != Some("pair_id,reference_ns,single_pass_ns") {
        return Err("invalid column header".into());
    }
    let mut samples = Vec::with_capacity(pairs);
    for id in 0..pairs {
        let mut row = lines.next().ok_or("truncated sample report")?.split(',');
        let row_id: usize = parse_number(row.next().ok_or("missing ID")?)?;
        let reference: u64 = parse_number(row.next().ok_or("missing reference")?)?;
        let single_pass: u64 = parse_number(row.next().ok_or("missing single-pass")?)?;
        if row.next().is_some() || row_id != id || reference == 0 || single_pass == 0 {
            return Err(format!("invalid sample at pair {id}"));
        }
        samples.push((reference, single_pass));
    }
    if lines.next().is_some() {
        return Err("unexpected trailing rows".into());
    }
    Ok(Report { items, seed, samples })
}

fn median(mut values: Vec<f64>) -> f64 {
    values.sort_by(f64::total_cmp);
    let m = values.len() / 2;
    if values.len() % 2 == 0 {
        values[m - 1].midpoint(values[m])
    } else {
        values[m]
    }
}

#[derive(Debug)]
struct Summary {
    reference_median_ns: f64,
    single_pass_median_ns: f64,
    paired_median_speedup: f64,
    reference_first_median_speedup: f64,
    single_pass_first_median_speedup: f64,
    wins: usize,
    ties: usize,
    losses: usize,
}

fn summarize(r: &Report) -> Summary {
    let speedups: Vec<_> = r.samples.iter().map(|&(a,b)| a as f64 / b as f64).collect();
    let wins = r.samples.iter().filter(|&&(a,b)| a > b).count();
    let ties = r.samples.iter().filter(|&&(a,b)| a == b).count();
    Summary {
        reference_median_ns: median(r.samples.iter().map(|&(a,_)| a as f64).collect()),
        single_pass_median_ns: median(r.samples.iter().map(|&(_,b)| b as f64).collect()),
        reference_first_median_speedup: median(speedups.iter().step_by(2).copied().collect()),
        single_pass_first_median_speedup: median(speedups.iter().skip(1).step_by(2).copied().collect()),
        paired_median_speedup: median(speedups),
        wins, ties, losses: r.samples.len() - wins - ties,
    }
}

fn run() -> Result<(), String> {
    let mut input = String::new();
    io::stdin().take(MAX_INPUT + 1).read_to_string(&mut input).map_err(|e| e.to_string())?;
    if input.len() as u64 > MAX_INPUT { return Err("input exceeds 128 KiB".into()); }
    let r = parse(&input)?;
    let s = summarize(&r);
    println!("workload=histogram16-v1 items={} seed={} pairs={}", r.items, r.seed, r.samples.len());
    println!("reference_median_ns={} single_pass_median_ns={}", s.reference_median_ns, s.single_pass_median_ns);
    println!("median_speedup={} paired_median_speedup={}", s.reference_median_ns / s.single_pass_median_ns, s.paired_median_speedup);
    println!("reference_first_speedup={} single_pass_first_speedup={}", s.reference_first_median_speedup, s.single_pass_first_median_speedup);
    println!("wins={} ties={} losses={}", s.wins, s.ties, s.losses);
    println!("scope=synthetic CPU only; order groups are descriptive, not causal or inferential");
    Ok(())
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => { eprintln!("{e}"); std::process::ExitCode::FAILURE }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(n: usize) -> String {
        let mut s = format!("workload=histogram16-v1,items=1024,pairs={n},seed=42\npair_id,reference_ns,single_pass_ns\n");
        for i in 0..n {
            s.push_str(&format!("{i},100,{}\n", if i % 2 == 0 { 50 } else { 100 }));
        }
        s
    }

    #[test]
    fn validates_and_splits_order_groups() {
        let r = parse(&fixture(20)).unwrap();
        let s = summarize(&r);
        assert_eq!(s.reference_first_median_speedup, 2.0);
        assert_eq!(s.single_pass_first_median_speedup, 1.0);
        assert_eq!(s.paired_median_speedup, 1.5);
        assert_eq!((s.wins,s.ties,s.losses), (10,10,0));
    }

    #[test]
    fn odd_pair_count() {
        let r = parse(&fixture(21)).unwrap();
        assert_eq!(summarize(&r).paired_median_speedup, 2.0);
    }

    #[test]
    fn handles_crlf() {
        assert!(parse(&fixture(20).replace('\n', "\r\n")).is_ok());
    }

    #[test]
    fn rejects_bad_metadata() {
        let s = fixture(20);
        for (a,b) in [("items=1024","items=0"),("pairs=20","pairs=0"),
                      ("pairs=20","pairs=1001"),("seed=42","seed=-1"),
                      ("items=1024","items=1048576"),("histogram16-v1","other")] {
            assert!(parse(&s.replace(a,b)).is_err(), "{b}");
        }
    }

    #[test]
    fn rejects_missing_or_extra_rows() {
        let s = fixture(20);
        assert!(parse(s.trim_end_matches("19,100,100\n")).is_err());
        assert!(parse(&(s + "20,100,50\n")).is_err());
    }

    #[test]
    fn rejects_duplicate_out_of_order_or_bad_samples() {
        let s = fixture(20);
        for row in ["0,100,100","3,100,100","1,0,100","1,100,0",
                    "1,100,NaN","1,100,100,2","1,-1,100","1,18446744073709551616,100"] {
            assert!(parse(&s.replace("1,100,100\n", &format!("{row}\n"))).is_err(), "{row}");
        }
    }

    #[test]
    fn counts_losses() {
        let s = fixture(20).replace(",100,50\n", ",100,200\n");
        let r = parse(&s).unwrap();
        assert_eq!(summarize(&r).losses, 10);
    }
}
