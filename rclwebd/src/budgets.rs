//! Per-connection sample write queue: byte/sample budgets and stable
//! dispositions (R2-01).
//!
//! Best-effort channels use latest-wins admission before WebSocket write: when
//! the queue is over budget, older framed samples are dropped and counted as
//! `sequence_gap` (the receiver observes the gap on the next delivered
//! sequence). Reliable channels never evict queued frames; an over-budget
//! admit drops the incoming sample *before* framing so sequence stays
//! contiguous. Slow clients therefore cannot balloon memory.

use bytes::Bytes;
use std::collections::VecDeque;

/// Registry disposition names (`protocol/registry/r2wp-v0.json` → dispositions).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Disposition {
    Delivered = 1,
    SequenceGap = 2,
    StaleSequence = 3,
}

impl Disposition {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Delivered => "delivered",
            Self::SequenceGap => "sequence_gap",
            Self::StaleSequence => "stale_sequence",
        }
    }
}

/// Observable disposition counters for one gateway process / connection.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DispositionCounters {
    pub delivered: u64,
    pub sequence_gap: u64,
    pub stale_sequence: u64,
    /// Reliable inbound samples dropped because the write queue was full
    /// (never framed — client sequence stays contiguous).
    pub reliable_queue_drop: u64,
}

impl DispositionCounters {
    pub fn record(&mut self, disposition: Disposition) {
        match disposition {
            Disposition::Delivered => self.delivered = self.delivered.saturating_add(1),
            Disposition::SequenceGap => self.sequence_gap = self.sequence_gap.saturating_add(1),
            Disposition::StaleSequence => {
                self.stale_sequence = self.stale_sequence.saturating_add(1)
            }
        }
    }
}

#[derive(Debug, Clone)]
struct QueuedFrame {
    #[allow(dead_code)]
    channel_id: u32,
    #[allow(dead_code)]
    reliable: bool,
    bytes: Bytes,
}

/// Bounded outbound sample queue shared by one connection.
#[derive(Debug)]
pub struct SampleWriteQueue {
    max_samples: usize,
    max_bytes: usize,
    items: VecDeque<QueuedFrame>,
    bytes: usize,
    pub dispositions: DispositionCounters,
}

impl SampleWriteQueue {
    #[must_use]
    pub fn new(max_samples: usize, max_bytes: usize) -> Self {
        Self {
            max_samples: max_samples.max(1),
            max_bytes: max_bytes.max(1),
            items: VecDeque::new(),
            bytes: 0,
            dispositions: DispositionCounters::default(),
        }
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.items.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    #[must_use]
    pub fn bytes(&self) -> usize {
        self.bytes
    }

    #[must_use]
    pub fn can_fit(&self, frame_len: usize) -> bool {
        if frame_len > self.max_bytes {
            return false;
        }
        self.items.len() < self.max_samples
            && self.bytes.saturating_add(frame_len) <= self.max_bytes
    }

    /// Admit a best-effort framed sample with latest-wins eviction.
    ///
    /// Sequence was already assigned when the frame was built; dropped frames
    /// (evicted or rejected) count as [`Disposition::SequenceGap`].
    pub fn admit_best_effort(&mut self, channel_id: u32, frame: Bytes) {
        let len = frame.len();
        if len > self.max_bytes {
            self.dispositions.record(Disposition::SequenceGap);
            return;
        }
        while !self.can_fit(len) {
            if let Some(old) = self.pop_front_raw() {
                let _ = old;
                self.dispositions.record(Disposition::SequenceGap);
            } else {
                break;
            }
        }
        if self.can_fit(len) {
            self.push(channel_id, false, frame);
        } else {
            self.dispositions.record(Disposition::SequenceGap);
        }
    }

    /// Try to reserve space for a reliable sample before framing.
    ///
    /// Returns false when the queue cannot accept another frame without
    /// eviction (reliable never evicts). Does not mutate disposition counters;
    /// the caller records [`DispositionCounters::reliable_queue_drop`].
    pub fn try_reserve_reliable(&mut self, frame_len: usize) -> bool {
        self.can_fit(frame_len)
    }

    /// Push a framed reliable sample after a successful [`Self::try_reserve_reliable`].
    pub fn push_reliable(&mut self, channel_id: u32, frame: Bytes) {
        debug_assert!(self.can_fit(frame.len()) || self.items.is_empty());
        self.push(channel_id, true, frame);
    }

    pub fn pop_front(&mut self) -> Option<Bytes> {
        self.pop_front_raw().map(|q| q.bytes)
    }

    pub fn record_delivered(&mut self) {
        self.dispositions.record(Disposition::Delivered);
    }

    pub fn record_stale_sequence(&mut self) {
        self.dispositions.record(Disposition::StaleSequence);
    }

    pub fn record_sequence_gap(&mut self) {
        self.dispositions.record(Disposition::SequenceGap);
    }

    fn push(&mut self, channel_id: u32, reliable: bool, frame: Bytes) {
        self.bytes = self.bytes.saturating_add(frame.len());
        self.items.push_back(QueuedFrame {
            channel_id,
            reliable,
            bytes: frame,
        });
    }

    fn pop_front_raw(&mut self) -> Option<QueuedFrame> {
        let item = self.items.pop_front()?;
        self.bytes = self.bytes.saturating_sub(item.bytes.len());
        Some(item)
    }
}

/// Wire budget map for ChannelReady / SessionReady key 12.
#[must_use]
pub fn effective_budgets_map(
    max_samples: u64,
    max_bytes: u64,
    max_message_bytes: u64,
) -> rclweb::CborValue<'static> {
    rclweb::CborValue::Map(vec![
        (1, rclweb::CborValue::Unsigned(max_samples)),
        (2, rclweb::CborValue::Unsigned(max_bytes)),
        (3, rclweb::CborValue::Unsigned(max_message_bytes)),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn best_effort_latest_wins_evicts_oldest() {
        let mut q = SampleWriteQueue::new(2, 10_000);
        q.admit_best_effort(1, Bytes::from(vec![1u8; 10]));
        q.admit_best_effort(1, Bytes::from(vec![2u8; 10]));
        assert_eq!(q.len(), 2);
        q.admit_best_effort(1, Bytes::from(vec![3u8; 10]));
        assert_eq!(q.len(), 2);
        assert_eq!(q.dispositions.sequence_gap, 1);
        let first = q.pop_front().unwrap();
        assert_eq!(first[0], 2);
        let second = q.pop_front().unwrap();
        assert_eq!(second[0], 3);
    }

    #[test]
    fn reliable_reserve_rejects_without_eviction() {
        let mut q = SampleWriteQueue::new(1, 10_000);
        assert!(q.try_reserve_reliable(10));
        q.push_reliable(1, Bytes::from(vec![9u8; 10]));
        assert!(!q.try_reserve_reliable(10));
        assert_eq!(q.len(), 1);
    }
}
