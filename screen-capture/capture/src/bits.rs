// An MSB-first bit writer for av1enc.rs's packed headers (AV1 OBUs).

#[derive(Default)]
pub struct Bits {
    pub buf: Vec<u8>,
    pub bits: usize,
}

impl Bits {
    pub fn put(&mut self, v: u32, n: u32) {
        for i in (0..n).rev() {
            if self.bits.is_multiple_of(8) {
                self.buf.push(0);
            }
            if (v >> i) & 1 != 0 {
                self.buf[self.bits / 8] |= 0x80 >> (self.bits % 8);
            }
            self.bits += 1;
        }
    }

    pub fn flag(&mut self, b: bool) {
        self.put(b as u32, 1)
    }

    pub fn trailing(&mut self) {
        self.put(1, 1);
        while !self.bits.is_multiple_of(8) {
            self.put(0, 1);
        }
    }
}
