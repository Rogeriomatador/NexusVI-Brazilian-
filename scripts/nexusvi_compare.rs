// SPDX-License-Identifier: GPL-3.0-or-later
//! Compare matched, independently collected synthetic timing samples.
use std::{collections::BTreeMap, fs::File, io::Read, path::Path};

const MAX_BYTES: u64 = 8 * 1024 * 1024;
const MIN_PAIRS: usize = 20;

#[derive(Debug)]
struct Run {
    revision: String,
    context: String,
    samples: BTreeMap<u64, f64>,
}

fn parse(input: &str) -> Result<Run, String> {
    let mut lines = input.lines();
    let rev = lines.next().and_then(|s| s.strip_prefix("revision="))
        .filter(|s| s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("expected revision=<40 hex digits>")?;
    let context = lines.next().and_then(|s| s.strip_prefix("context="))
        .filter(|s| !s.trim().is_empty() && s.len() <= 1024)
        .ok_or("expected nonempty context of at most 1024 bytes")?;
    if lines.next() != Some("pair_id,ms") {
        return Err("expected pair_id,ms header".into());
    }
    let mut samples = BTreeMap::new();
    for (i, line) in lines.enumerate() {
        let (id, value) = line.split_once(',').ok_or_else(|| format!("invalid row {}", i + 4))?;
        let id: u64 = id.parse().map_err(|_| format!("invalid pair ID at row {}", i + 4))?;
        let ms: f64 = value.parse().map_err(|_| format!("invalid timing at row {}", i + 4))?;
        if !ms.is_finite() || ms <= 0.0 {
            return Err(format!("nonpositive or nonfinite timing at row {}", i + 4));
        }
        if samples.insert(id, ms).is_some() {
            return Err(format!("duplicate pair ID {id}"));
        }
    }
    Ok(Run { revision: rev.to_ascii_lowercase(), context: context.into(), samples })
}

fn read(path: &Path) -> Result<Run, String> {
    let mut input = String::new();
    File::open(path).map_err(|e| e.to_string())?.take(MAX_BYTES + 1)
        .read_to_string(&mut input).map_err(|e| e.to_string())?;
    if input.len() as u64 > MAX_BYTES {
        return Err("input exceeds 8 MiB".into());
    }
    parse(&input)
}

fn median(sorted: &[f64]) -> f64 {
    let n = sorted.len();
    if n % 2 == 0 { sorted[n / 2 - 1].midpoint(sorted[n / 2]) }
    else { sorted[n / 2] }
}

fn p95(sorted: &[f64]) -> f64 {
    sorted[sorted.len() - sorted.len() / 20 - 1]
}

#[derive(Debug, PartialEq)]
struct Comparison {
    pairs: usize,
    median_ratio: f64,
    p95_ratio: f64,
    paired_median_ratio: f64,
    slower_pairs: usize,
    regression: bool,
}

fn ratio(candidate: f64, baseline: f64) -> Result<f64, String> {
    let value = candidate / baseline;
    if !value.is_finite() || value <= 0.0 {
        return Err("timing ratio is outside the representable range".into());
    }
    Ok(value)
}

fn compare(base: &Run, candidate: &Run) -> Result<Comparison, String> {
    if base.revision == candidate.revision {
        return Err("revisions must differ".into());
    }
    if base.context != candidate.context {
        return Err("declared benchmark contexts differ".into());
    }
    if base.samples.len() < MIN_PAIRS {
        return Err(format!("at least {MIN_PAIRS} matched pairs required"));
    }
    if !base.samples.keys().eq(candidate.samples.keys()) {
        return Err("pair IDs do not match exactly".into());
    }
    let mut b = Vec::with_capacity(base.samples.len());
    let mut c = Vec::with_capacity(base.samples.len());
    let mut paired = Vec::with_capacity(base.samples.len());
    let mut slower_pairs = 0;
    for (id, &before) in &base.samples {
        let after = candidate.samples[id];
        b.push(before);
        c.push(after);
        paired.push(ratio(after, before)?);
        slower_pairs += usize::from(after > before);
    }
    for values in [&mut b, &mut c, &mut paired] {
        values.sort_by(f64::total_cmp);
    }
    let median_ratio = ratio(median(&c), median(&b))?;
    let p95_ratio = ratio(p95(&c), p95(&b))?;
    let paired_median_ratio = median(&paired);
    // Descriptive screening thresholds, not statistical significance.
    let regression = median_ratio > 1.05 || p95_ratio > 1.10 || paired_median_ratio > 1.05;
    Ok(Comparison { pairs: b.len(), median_ratio, p95_ratio, paired_median_ratio, slower_pairs, regression })
}

fn run() -> Result<bool, String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 2 {
        return Err("usage: nexusvi_compare BASELINE.csv CANDIDATE.csv".into());
    }
    let base = read(Path::new(&args[0]))?;
    let candidate = read(Path::new(&args[1]))?;
    let c = compare(&base, &candidate)?;
    println!("baseline={} candidate={}", base.revision, candidate.revision);
    println!("pairs={} median_ratio={:.8} p95_ratio={:.8} paired_median_ratio={:.8} slower_pairs={}",
        c.pairs, c.median_ratio, c.p95_ratio, c.paired_median_ratio, c.slower_pairs);
    println!("screen={} (descriptive thresholds only; context is user-declared)",
        if c.regression { "regression" } else { "within_threshold" });
    Ok(c.regression)
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(false) => std::process::ExitCode::SUCCESS,
        Ok(true) => std::process::ExitCode::from(2),
        Err(e) => { eprintln!("{e}"); std::process::ExitCode::FAILURE }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(rev: char, ms: f64) -> Run {
        Run { revision: rev.to_string().repeat(40), context: "synthetic cpu test".into(),
            samples: (0..20).map(|id| (id, ms)).collect() }
    }

    #[test]
    fn equal_and_improved() {
        let base = fixture('a', 10.0);
        let equal = compare(&base, &fixture('b', 10.0)).unwrap();
        assert_eq!(equal.median_ratio, 1.0);
        assert!(!equal.regression);
        let better = compare(&base, &fixture('b', 8.0)).unwrap();
        assert_eq!(better.median_ratio, 0.8);
        assert_eq!(better.slower_pairs, 0);
        assert!(!better.regression);
    }

    #[test]
    fn median_regression() {
        assert!(compare(&fixture('a', 10.0), &fixture('b', 11.0)).unwrap().regression);
    }

    #[test]
    fn tail_regression_even_with_same_median() {
        let mut c = fixture('b', 10.0);
        c.samples.insert(18, 20.0);
        c.samples.insert(19, 20.0);
        let r = compare(&fixture('a', 10.0), &c).unwrap();
        assert_eq!(r.median_ratio, 1.0);
        assert_eq!(r.p95_ratio, 2.0);
        assert!(r.regression);
    }

    #[test]
    fn paired_changes_are_not_hidden_by_aggregate_median() {
        let mut b = fixture('a', 1.0);
        let mut c = fixture('b', 1.0);
        for id in 0..20 {
            b.samples.insert(id, 2.0_f64.powi(id as i32));
            c.samples.insert(id, 2.0_f64.powi(((id + 1) % 20) as i32));
        }
        let r = compare(&b, &c).unwrap();
        assert_eq!(r.median_ratio, 1.0);
        assert_eq!(r.paired_median_ratio, 2.0);
        assert!(r.regression);
    }

    #[test]
    fn rejects_mismatched_ids() {
        let mut c = fixture('b', 10.0);
        c.samples.remove(&0);
        c.samples.insert(99, 10.0);
        assert!(compare(&fixture('a', 10.0), &c).is_err());
    }

    #[test]
    fn rejects_context_and_revision_mismatch() {
        let base = fixture('a', 10.0);
        assert!(compare(&base, &fixture('a', 10.0)).is_err());
        let mut c = fixture('b', 10.0);
        c.context.push_str(" different");
        assert!(compare(&base, &c).is_err());
    }

    #[test]
    fn rejects_too_few_pairs() {
        let mut b = fixture('a', 10.0);
        b.samples.remove(&0);
        assert!(compare(&b, &fixture('b', 10.0)).is_err());
    }

    #[test]
    fn rejects_extreme_ratios() {
        assert!(compare(&fixture('a', f64::from_bits(1)), &fixture('b', f64::MAX)).is_err());
    }

    #[test]
    fn parses_unsorted_crlf_rows() {
        let r = parse(&format!("revision={}\r\ncontext=synthetic\r\npair_id,ms\r\n3,2.5\r\n1,1.0\r\n", "a".repeat(40))).unwrap();
        assert_eq!(r.samples.keys().copied().collect::<Vec<_>>(), vec![1, 3]);
    }

    #[test]
    fn rejects_malformed_or_duplicate_rows() {
        let prefix = format!("revision={}\ncontext=synthetic\npair_id,ms\n", "a".repeat(40));
        for rows in ["1,1\n1,2", "1,NaN", "1,inf", "1,0", "1,-1", "a,1", "1,1,2"] {
            assert!(parse(&format!("{prefix}{rows}")).is_err(), "{rows}");
        }
        assert!(parse("revision=short\ncontext=x\npair_id,ms").is_err());
    }
}
