// SPDX-License-Identifier: GPL-3.0-or-later
//! Standalone summary of synthetic timing samples, in milliseconds.
use std::io::{self, Read};

#[derive(Debug, PartialEq)]
struct Stats {
    count: usize,
    median_ms: f64,
    p95_ms: f64,
    p99_ms: f64,
    min_ms: f64,
    max_ms: f64,
}

fn summarize(mut samples: Vec<f64>) -> Result<Stats, &'static str> {
    if samples.is_empty() {
        return Err("no timing samples");
    }
    if samples.iter().any(|x| !x.is_finite() || *x <= 0.0) {
        return Err("timings must be finite and positive");
    }
    samples.sort_by(f64::total_cmp);
    let count = samples.len();
    let mid = count / 2;
    let median_ms = if count % 2 == 0 {
        samples[mid - 1].midpoint(samples[mid])
    } else {
        samples[mid]
    };
    // ceil(95% * count), without multiplication overflow.
    let rank = count - count / 20;
    Ok(Stats {
        count,
        median_ms,
        p95_ms: samples[rank - 1],
        p99_ms: samples[count - count / 100 - 1],
        min_ms: samples[0],
        max_ms: samples[count - 1],
    })
}

fn run() -> Result<(), String> {
    let mut input = String::new();
    // Bound memory use even when stdin is a very large stream.
    const MAX_INPUT: u64 = 8 * 1024 * 1024;
    io::stdin().take(MAX_INPUT + 1).read_to_string(&mut input).map_err(|e| e.to_string())?;
    if input.len() as u64 > MAX_INPUT {
        return Err("input exceeds 8 MiB".into());
    }
    let samples = input.split_whitespace()
        .map(|s| s.parse::<f64>().map_err(|_| format!("invalid sample: {s}")))
        .collect::<Result<Vec<_>, _>>()?;
    let s = summarize(samples).map_err(str::to_owned)?;
    println!("count={} median_ms={} p95_ms={} p99_ms={} min_ms={} max_ms={}",
        s.count, s.median_ms, s.p95_ms, s.p99_ms, s.min_ms, s.max_ms);
    Ok(())
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsorted_even_samples() {
        assert_eq!(summarize(vec![4.0, 1.0, 3.0, 2.0]).unwrap(),
            Stats { count: 4, median_ms: 2.5, p95_ms: 4.0, p99_ms: 4.0, min_ms: 1.0, max_ms: 4.0 });
    }

    #[test]
    fn nearest_rank_at_twenty() {
        let s = summarize((1..=20).rev().map(f64::from).collect()).unwrap();
        assert_eq!(s, Stats { count: 20, median_ms: 10.5, p95_ms: 19.0, p99_ms: 20.0, min_ms: 1.0, max_ms: 20.0 });
    }

    #[test]
    fn one_sample() {
        assert_eq!(summarize(vec![2.0]).unwrap(),
            Stats { count: 1, median_ms: 2.0, p95_ms: 2.0, p99_ms: 2.0, min_ms: 2.0, max_ms: 2.0 });
    }

    #[test]
    fn invalid_samples() {
        for x in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(summarize(vec![1.0, x]).is_err());
        }
        assert!(summarize(vec![]).is_err());
    }

    #[test]
    fn p99_nearest_rank_at_one_hundred() {
        let s = summarize((1..=100).rev().map(f64::from).collect()).unwrap();
        assert_eq!(s.p95_ms, 95.0);
        assert_eq!(s.p99_ms, 99.0);
    }

    #[test]
    fn median_preserves_smallest_positive_sample() {
        let tiny = f64::from_bits(1);
        assert_eq!(summarize(vec![tiny, tiny]).unwrap().median_ms, tiny);
    }

    #[test]
    fn median_does_not_overflow() {
        assert_eq!(summarize(vec![f64::MAX, f64::MAX]).unwrap().median_ms, f64::MAX);
    }
}
