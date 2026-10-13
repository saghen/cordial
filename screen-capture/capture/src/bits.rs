// An MSB-first bit writer for the packed headers both encoders write (AV1 OBUs in av1enc.rs, H.264 NAL units in
// h264enc.rs).

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

    /// Exp-Golomb, unsigned (H.264 ue(v))
    pub fn ue(&mut self, v: u32) {
        let v = v as u64 + 1;
        let n = 64 - v.leading_zeros();
        self.put(0, n - 1);
        for i in (0..n).rev() {
            self.put((v >> i) as u32 & 1, 1);
        }
    }

    /// Exp-Golomb, signed (H.264 se(v))
    pub fn se(&mut self, v: i32) {
        self.ue(if v > 0 { 2 * v as u32 - 1 } else { 2 * v.unsigned_abs() })
    }

    pub fn trailing(&mut self) {
        self.put(1, 1);
        while !self.bits.is_multiple_of(8) {
            self.put(0, 1);
        }
    }
}
