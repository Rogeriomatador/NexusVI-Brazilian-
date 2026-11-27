// SPDX-License-Identifier: GPL-3.0-or-later
//! Independent CPU-only synthetic benchmark control. No runtime dependencies.
use std::{hint::black_box, time::Instant};

const BINS: usize = 16;
const MAX_ITEMS: usize = 1_048_576;
const MAX_PAIRS: usize = 1000;
const MAX_WORK: usize = 16_777_216;
type Histogram = [usize; BINS];

#[derive(Clone, Copy, Debug)]
struct Config {
    items: usize,
    pairs: usize,
    seed: u64,
}

fn validate(c: Config) -> Result<Config, &'static str> {
    if !(1024..=MAX_ITEMS).contains(&c.items) {
        return Err("items must be between 1024 and 1048576");
    }
    if !(20..=MAX_PAIRS).contains(&c.pairs) {
        return Err("pairs must be between 20 and 1000");
    }
    if c.items > MAX_WORK / c.pairs {
        return Err("combined items times pairs exceeds work budget");
    }
    Ok(c)
}

// SplitMix64: fixed arithmetic and seed produce the same data across platforms.
fn next(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e3779b97f4a7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
    z ^ (z >> 31)
}

fn fill(values: &mut [u32], state: &mut u64) {
    for x in values {
        *x = next(state) as u32;
    }
}

fn reference(values: &[u32]) -> Histogram {
    std::array::from_fn(|bin| {
        values.iter().filter(|&&x| x as usize % BINS == bin).count()
    })
}

fn single_pass(values: &[u32]) -> Histogram {
    let mut counts = [0; BINS];
    for &x in values {
        counts[x as usize % BINS] += 1;
    }
    counts
}

#[derive(Debug)]
struct Sample {
    reference_ns: u128,
    single_pass_ns: u128,
}

fn timed(f: fn(&[u32]) -> Histogram, values: &[u32]) -> (Histogram, u128) {
    let t = Instant::now();
    let result = black_box(f(black_box(values)));
    (result, t.elapsed().as_nanos())
}

fn collect(c: Config) -> Result<Vec<Sample>, &'static str> {
    let c = validate(c)?;
    let mut values = vec![0; c.items];
    let mut seed = c.seed;
    // Warm up both paths without recording or reusing these inputs.
    fill(&mut values, &mut seed);
    if black_box(reference(&values)) != black_box(single_pass(&values)) {
        return Err("warmup output mismatch");
    }

    let mut samples = Vec::with_capacity(c.pairs);
    for pair in 0..c.pairs {
        fill(&mut values, &mut seed);
        // Alternate first runner to reduce systematic order effects.
        let ((a, an), (b, bn)) = if pair % 2 == 0 {
            (timed(reference, &values), timed(single_pass, &values))
        } else {
            let b = timed(single_pass, &values);
            let a = timed(reference, &values);
            (a, b)
        };
        if a != b || a.iter().sum::<usize>() != c.items {
            return Err("histogram output mismatch");
        }
        if an == 0 || bn == 0 {
            return Err("timer resolution insufficient; increase items");
        }
        samples.push(Sample { reference_ns: an, single_pass_ns: bn });
    }
    Ok(samples)
}

fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        return Err("usage: nexusvi_synthetic ITEMS PAIRS SEED".into());
    }
    let c = Config {
        items: args[0].parse().map_err(|_| "invalid items")?,
        pairs: args[1].parse().map_err(|_| "invalid pairs")?,
        seed: args[2].parse().map_err(|_| "invalid seed")?,
    };
    let samples = collect(c)?;
    // Only publish a report after all results pass correctness checks.
    println!("workload=histogram16-v1,items={},pairs={},seed={}", c.items, c.pairs, c.seed);
    println!("pair_id,reference_ns,single_pass_ns");
    for (i, s) in samples.iter().enumerate() {
        println!("{i},{},{}", s.reference_ns, s.single_pass_ns);
    }
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
    fn deterministic_sequence() {
        let mut seed = 0;
        assert_eq!(next(&mut seed), 0xe220a8397b1dcdaf);
        assert_eq!(next(&mut seed), 0x6e789e6aa1b965f4);
    }

    #[test]
    fn exact_known_histogram() {
        let data = [0, 16, 32, 1, 17, u32::MAX];
        let mut expected = [0; BINS];
        expected[0] = 3;
        expected[1] = 2;
        expected[15] = 1;
        assert_eq!(reference(&data), expected);
        assert_eq!(single_pass(&data), expected);
    }

    #[test]
    fn empty_and_all_identical_inputs() {
        assert_eq!(single_pass(&[]), [0; BINS]);
        let values = vec![31; 4096];
        assert_eq!(single_pass(&values)[15], 4096);
        assert_eq!(reference(&values), single_pass(&values));
    }

    #[test]
    fn differential_across_seeds_and_sizes() {
        for mut seed in [0, 1, 23, 123456, u64::MAX] {
            for n in [0, 1, 15, 16, 17, 1024, 4097] {
                let mut data = vec![0; n];
                fill(&mut data, &mut seed);
                let actual = single_pass(&data);
                assert_eq!(actual, reference(&data));
                assert_eq!(actual.iter().sum::<usize>(), n);
            }
        }
    }

    #[test]
    fn deterministic_fill() {
        let mut a = [0; 128];
        let mut b = [0; 128];
        fill(&mut a, &mut 42);
        fill(&mut b, &mut 42);
        assert_eq!(a, b);
    }

    #[test]
    fn validates_work_budget_without_overflow() {
        let c = Config { items: 4096, pairs: 20, seed: 0 };
        assert!(validate(c).is_ok());
        assert!(validate(Config { items: usize::MAX, ..c }).is_err());
        assert!(validate(Config { pairs: 0, ..c }).is_err());
        assert!(validate(Config { pairs: 19, ..c }).is_err());
        assert!(validate(Config { items: 1023, ..c }).is_err());
        assert!(validate(Config { items: MAX_ITEMS, pairs: MAX_PAIRS, ..c }).is_err());
    }
}
