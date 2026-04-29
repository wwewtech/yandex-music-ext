class ID3Writer {
    constructor(mp3Buffer) {
        this.mp3Buffer = mp3Buffer;
        this.frames = [];
    }
    
    _encodeSyncSafe(size) {
        return [
            (size >>> 21) & 0x7f,
            (size >>> 14) & 0x7f,
            (size >>> 7) & 0x7f,
            size & 0x7f
        ];
    }
    
    _stringToUtf16le(str) {
        const buf = new Uint8Array(str.length * 2 + 2);
        buf[0] = 0xff; // BOM
        buf[1] = 0xfe;
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            buf[i * 2 + 2] = code & 0xff;
            buf[i * 2 + 3] = (code >>> 8) & 0xff;
        }
        return buf;
    }

    addTextFrame(id, text) {
        if (!text) return;
        const textBytes = this._stringToUtf16le(text);
        const frameData = new Uint8Array(1 + textBytes.length);
        frameData[0] = 0x01; // Encoding: UTF-16
        frameData.set(textBytes, 1);
        this.frames.push({ id, data: frameData });
    }

    addPictureFrame(pictureBuffer, mimeType = 'image/jpeg') {
        if (!pictureBuffer) return;
        const mimeBytes = new TextEncoder().encode(mimeType);
        const frameData = new Uint8Array(1 + mimeBytes.length + 1 + 1 + 1 + pictureBuffer.byteLength);
        let offset = 0;
        frameData[offset++] = 0x00; // Encoding: ISO-8859-1
        frameData.set(mimeBytes, offset);
        offset += mimeBytes.length;
        frameData[offset++] = 0x00; // Null separator
        frameData[offset++] = 0x03; // Picture type: 3 = Front cover
        frameData[offset++] = 0x00; // Description: Null
        frameData.set(new Uint8Array(pictureBuffer), offset);
        
        this.frames.push({ id: 'APIC', data: frameData });
    }

    getTaggedBuffer() {
        let framesSize = 0;
        for (const frame of this.frames) {
            framesSize += 10 + frame.data.length; // 10 bytes header per frame
        }
        
        const headerSize = 10;
        const totalId3Size = framesSize;
        const syncSafeSize = this._encodeSyncSafe(totalId3Size);
        
        const tagged = new Uint8Array(headerSize + totalId3Size + this.mp3Buffer.byteLength);
        
        // ID3 Header
        tagged.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00], 0); // "ID3", v2.3.0, no flags
        tagged.set(syncSafeSize, 6);
        
        let offset = 10;
        for (const frame of this.frames) {
            const idBytes = new TextEncoder().encode(frame.id);
            tagged.set(idBytes, offset);
            offset += 4;
            
            const flen = frame.data.length;
            // Frame size in v2.3 is NOT syncsafe integer, just standard 32-bit int
            tagged.set([
                (flen >>> 24) & 0xff,
                (flen >>> 16) & 0xff,
                (flen >>> 8) & 0xff,
                flen & 0xff
            ], offset);
            offset += 4;
            
            tagged.set([0x00, 0x00], offset); // Flags
            offset += 2;
            
            tagged.set(frame.data, offset);
            offset += flen;
        }
        
        tagged.set(new Uint8Array(this.mp3Buffer), offset);
        return tagged.buffer;
    }
}
window.ID3Writer = ID3Writer;
