function sanitizeText(text) {
    let sanitizedText = '';

    for (let i=0; i<text.length; i++) {
        let charCode = text.charCodeAt(i);

        if (charCode >= 32 && charCode <= 126){
            sanitizedText += text.charAt(i);
        }
    }

    return sanitizedText;
}

// all data is little endian
function getInt16 (buffer, offset) {
    if ((buffer.length - offset) >= 2) {
        return (buffer[offset + 1] << 8) + buffer[offset];
    }
    return 0;
}

function getInt32 (buffer, offset) {
    if ((buffer.length - offset) >= 4) {
        // in javascript bit shifts are always performed on signed 32bit ints (even though storage is 64bit int!)
        // solution is to use *256 instead of bit shift
        let value = 0;
        for ( let i = 3; i >= 0; i--) {
            value = (value * 256) + buffer[offset + i];
        }
        return value;
    }
    return 0;
}

// only good for strings < 1k
function getString (buffer, index, length) {
    let rawString;

    if (typeof length === 'number') {
        rawString = String.fromCharCode.apply(null, buffer.subarray(index, index + length));
    }
    else {
        rawString = String.fromCharCode.apply(null, buffer.subarray(index));
    }

    return sanitizeText(rawString);
}

function getHexString (buffer, offset, length) {

    let copyLength = buffer.length;
    
    if (typeof offset !== 'number') {
        offset = 0;
    }

    if ((typeof length === 'number') && (length < buffer.length)) {
        copyLength = length;
    }

    let hexString = '';
    for (let i=0; i<copyLength; i++) {
        hexString += ('0' + (buffer[i + offset] & 0xFF).toString(16)).slice(-2);
    }

    return hexString;
}

function setInt16(buffer, offset, value) {
    if ((buffer.length - offset) >= 2) {
        buffer[offset] = value & 0xFF;
        buffer[offset + 1] = (value >> 8) & 0xFF;
        return;
    }

    console.error("setInt16 offset out of bounds");
}

function setInt24(buffer, offset, value) {
    if ((buffer.length - offset) >= 3) {
        buffer[offset] = value & 0xFF;
        buffer[offset + 1] = (value >> 8) & 0xFF;
        buffer[offset + 2] = (value >> 16) & 0xFF;
        return;
    }

    console.error("setInt24 offset out of bounds");
}

function setInt32(buffer, offset, value) {
    if ((buffer.length - offset) >= 4) {
        buffer[offset] = value & 0xFF;
        buffer[offset + 1] = (value >> 8) & 0xFF;
        buffer[offset + 2] = (value >> 16) & 0xFF;
        buffer[offset + 3] = (value >> 24) & 0xFF;
        return;
    }

    console.error("setInt32 offset out of bounds");
}

function setString(buffer, offset, length, data) {
    let i;

    if ((buffer.length - offset) < length) {
        console.error("setString:: offset out of bounds");
        return;
    }

    let sanitizedString = sanitizeText(data);

    for (i=0; i<length; i++) {
        if (sanitizedString.length > i) {
            buffer[offset + i] = sanitizedString.charCodeAt(i);
        }
        else {
            buffer[offset + i] = 0;
        }
    }
}

function setHexString (buffer, offset, hexString) {
    let j=0;
    for (let i=0; i<(hexString.length-1); i+=2) {
        buffer[offset + j] = parseInt(hexString.substr(i, 2), 16);
        j++;
    }
}

module.exports = {
    sanitizeText,
    getInt16,
    getInt32,
    getString,
    getHexString,
    setInt16,
    setInt24,
    setInt32,
    setString,
    setHexString
}