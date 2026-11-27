// SPDX-License-Identifier: GPL-3.0-or-later
//! Standalone range-allocation model for synthetic correctness experiments.
//! No real memory mappings, external processes, GPU or compatibility runtime.
use std::collections::BTreeMap;

const MAX_CAPACITY: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Handle {
    offset: usize,
    len: usize,
    serial: u64,
}

#[derive(Debug, Eq, PartialEq)]
enum Error {
    Invalid,
    Exhausted,
    SerialExhausted,
    UnknownHandle,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Arena {
    capacity: usize,
    free: BTreeMap<usize, usize>,
    live: BTreeMap<usize, Handle>,
    next_serial: u64,
}

impl Arena {
    fn new(capacity: usize) -> Result<Self, Error> {
        if capacity == 0 || capacity > MAX_CAPACITY {
            return Err(Error::Invalid);
        }
        Ok(Self {
            capacity,
            free: BTreeMap::from([(0, capacity)]),
            live: BTreeMap::new(),
            next_serial: 1,
        })
    }

    fn allocate(&mut self, len: usize, align: usize) -> Result<Handle, Error> {
        if len == 0 || len > self.capacity || !align.is_power_of_two() {
            return Err(Error::Invalid);
        }
        // Search without mutating state. All fallible arithmetic precedes updates.
        let (start, end, offset, stop) = self.free.iter().find_map(|(&start, &size)| {
            let end = start.checked_add(size)?;
            let offset = start.checked_add(align - 1)? & !(align - 1);
            let stop = offset.checked_add(len)?;
            (stop <= end).then_some((start, end, offset, stop))
        }).ok_or(Error::Exhausted)?;
        let serial = self.next_serial;
        let next_serial = serial.checked_add(1).ok_or(Error::SerialExhausted)?;
        let handle = Handle { offset, len, serial };
        self.free.remove(&start);
        if start < offset {
            self.free.insert(start, offset - start);
        }
        if stop < end {
            self.free.insert(stop, end - stop);
        }
        self.live.insert(offset, handle);
        self.next_serial = next_serial;
        Ok(handle)
    }

    fn release(&mut self, handle: Handle) -> Result<(), Error> {
        if self.live.get(&handle.offset) != Some(&handle) {
            return Err(Error::UnknownHandle);
        }
        // Valid live ranges lie inside capacity. Neighbors cannot overlap them.
        let mut start = handle.offset;
        let mut end = start + handle.len;
        let left = self.free.range(..start).next_back().map(|(&s,&n)| (s,n));
        let right = self.free.range(end..).next().map(|(&s,&n)| (s,n));
        self.live.remove(&handle.offset);
        if let Some((s,n)) = left {
            if s + n == start {
                self.free.remove(&s);
                start = s;
            }
        }
        if let Some((s,n)) = right {
            if s == end {
                self.free.remove(&s);
                end = s + n;
            }
        }
        self.free.insert(start, end - start);
        Ok(())
    }

    fn free_bytes(&self) -> usize {
        self.free.values().sum()
    }

    fn largest_free(&self) -> usize {
        self.free.values().copied().max().unwrap_or(0)
    }

    fn consistent(&self) -> bool {
        let mut ranges: Vec<_> = self.free.iter().map(|(&s,&n)| (s,n,true))
            .chain(self.live.iter().map(|(&s,h)| (s,h.len,false))).collect();
        ranges.sort_unstable_by_key(|r| r.0);
        let mut cursor = 0usize;
        let mut previous_free = false;
        for (s,n,free) in ranges {
            if s != cursor || n == 0 || (free && previous_free) {
                return false;
            }
            let Some(end) = cursor.checked_add(n) else { return false };
            cursor = end;
            previous_free = free;
        }
        cursor == self.capacity && self.live.iter().all(|(&s,h)| {
            h.offset == s && h.serial > 0 && h.serial < self.next_serial
        })
    }
}

fn run() -> Result<(), String> {
    let mut arena = Arena::new(4096).map_err(|e| format!("{e:?}"))?;
    let a = arena.allocate(129, 64).map_err(|e| format!("{e:?}"))?;
    let b = arena.allocate(300, 256).map_err(|e| format!("{e:?}"))?;
    if !arena.consistent() { return Err("partition mismatch".into()); }
    println!("synthetic capacity=4096 live=429 free={} largest_free={}",
        arena.free_bytes(), arena.largest_free());
    for h in [a,b] {
        arena.release(h).map_err(|e| format!("{e:?}"))?;
    }
    if !arena.consistent() || arena.largest_free() != 4096 {
        return Err("coalescing failed".into());
    }
    println!("synthetic fully_reclaimed=4096");
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

    #[test]
    fn aligned_split_and_two_sided_merge() {
        let mut a = Arena::new(64).unwrap();
        let x = a.allocate(3,1).unwrap();
        let y = a.allocate(8,16).unwrap();
        assert_eq!(y.offset,16);
        assert_eq!(a.free_bytes(),53);
        a.release(y).unwrap();
        assert_eq!(a.largest_free(),61);
        a.release(x).unwrap();
        assert_eq!(a.free, BTreeMap::from([(0,64)]));
        assert!(a.consistent());
    }

    #[test]
    fn stale_and_forged_handles_cannot_free_reused_offset() {
        let mut a = Arena::new(16).unwrap();
        let old = a.allocate(8,1).unwrap();
        a.release(old).unwrap();
        let new = a.allocate(8,1).unwrap();
        assert_eq!(old.offset,new.offset);
        assert_ne!(old.serial,new.serial);
        let snapshot = a.clone();
        assert_eq!(a.release(old),Err(Error::UnknownHandle));
        assert_eq!(a.release(Handle { len: 7, ..new }),Err(Error::UnknownHandle));
        assert_eq!(a,snapshot);
    }

    #[test]
    fn invalid_or_exhausted_requests_are_atomic() {
        let mut a = Arena::new(16).unwrap();
        a.allocate(16,1).unwrap();
        let before = a.clone();
        for (len,align) in [(0,1),(17,1),(1,0),(1,3),(1,1),(1,usize::MAX)] {
            assert!(a.allocate(len,align).is_err());
            assert_eq!(a,before);
        }
    }

    #[test]
    fn serial_exhaustion_is_atomic() {
        let mut a = Arena::new(8).unwrap();
        a.next_serial = u64::MAX;
        let before = a.clone();
        assert_eq!(a.allocate(1,1),Err(Error::SerialExhausted));
        assert_eq!(a,before);
    }

    #[test]
    fn capacity_limits() {
        assert!(Arena::new(0).is_err());
        assert!(Arena::new(MAX_CAPACITY + 1).is_err());
        assert!(Arena::new(MAX_CAPACITY).unwrap().consistent());
    }

    // Exhaustive bounded histories, compared to a separate byte occupancy model.
    // Each step tries allocation of 1..3 bytes at 1/2/4 alignment or any live release.
    fn explore(a: Arena, bitmap: Vec<bool>, depth: usize, visited: &mut usize) {
        *visited += 1;
        assert!(a.consistent());
        assert_eq!(a.free_bytes(),bitmap.iter().filter(|&&x| !x).count());
        let mut reconstructed = vec![false; bitmap.len()];
        for h in a.live.values() {
            for v in &mut reconstructed[h.offset..h.offset+h.len] {
                assert!(!*v);
                *v = true;
            }
        }
        assert_eq!(reconstructed,bitmap);
        if depth == 0 { return; }
        for len in 1..=3 {
            for align in [1,2,4] {
                let expected = (0..=bitmap.len()-len).find(|&i|
                    i % align == 0 && bitmap[i..i+len].iter().all(|&x| !x));
                let mut next = a.clone();
                match (next.allocate(len,align),expected) {
                    (Ok(h),Some(offset)) => {
                        assert_eq!(h.offset,offset);
                        let mut b = bitmap.clone();
                        b[offset..offset+len].fill(true);
                        explore(next,b,depth-1,visited);
                    }
                    (Err(Error::Exhausted),None) => assert_eq!(next,a),
                    other => panic!("allocation mismatch: {other:?}"),
                }
            }
        }
        for &h in a.live.values() {
            let mut next = a.clone();
            next.release(h).unwrap();
            let mut b = bitmap.clone();
            b[h.offset..h.offset+h.len].fill(false);
            explore(next,b,depth-1,visited);
        }
    }

    #[test]
    fn exhaustive_small_histories_match_bitmap() {
        let mut visited = 0;
        explore(Arena::new(6).unwrap(),vec![false;6],5,&mut visited);
        assert!(visited > 1000);
        println!("exhaustive histories visited={visited}");
    }

    #[test]
    fn deterministic_long_sequence_reclaims_everything() {
        let mut a = Arena::new(8192).unwrap();
        let mut handles = Vec::new();
        let mut seed = 42u64;
        for _ in 0..20000 {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            if !handles.is_empty() && seed >> 63 == 0 {
                let index = ((seed >> 32) as usize) % handles.len();
                a.release(handles.swap_remove(index)).unwrap();
            } else {
                let len = 1 + ((seed >> 16) as usize & 255);
                let align = 1usize << ((seed >> 24) & 7);
                if let Ok(h) = a.allocate(len,align) {
                    assert_eq!(h.offset % align,0);
                    handles.push(h);
                }
            }
            assert!(a.consistent());
        }
        for h in handles { a.release(h).unwrap(); }
        assert_eq!(a.free_bytes(),8192);
        assert_eq!(a.largest_free(),8192);
        assert!(a.consistent());
    }
}
