// Copyright 2018 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

"use strict";

// IntervalMap is a map of intervals over AddrJS values.
class IntervalMap {
    // ranges must be an array of [low, high, ...] arrays, where ...
    // can be any additional data the caller wishes to store.
    constructor(ranges) {
        // Sort ranges.
        ranges.sort((a, b) => a[0].compare(b[0]));
        this.ranges = ranges;
    }

    // Intersect a list of ranges with the ranges in this map and
    // return the subset that overlap. ranges must already be sorted.
    intersect(ranges) {
        const out = [];
        let i = 0, j = 0;
        while (i < ranges.length && j < this.ranges.length) {
            if (IntervalMap.overlap(ranges[i], this.ranges[j])) {
                // Found a match.
                out.push(this.ranges[j]);
                j++;
            } else if (ranges[i][0] < this.ranges[j][0]) {
                i++;
            } else {
                j++;
            }
        }
        return out;
    }

    static overlap(r1, r2) {
        return r1[1].compare(r2[0]) > 0 && r1[0].compare(r2[1]) < 0;
    }
}

// AddrJS works in 28 bit digits because Javascript treats numbers as
// signed 32 bit values and we need something that divides evenly into
// hex digits.
const AddrJSBits = 28;
const AddrJSDigits = AddrJSBits / 4;

// AddrJS is a positive arbitrary precision integer, used for
// representing memory addresses.
class AddrJS {
    // AddrJS optionally takes a hex string or a number.
    //
    // TODO: Support negative numbers.
    constructor(x, _digits) {
        if (_digits !== undefined) {
            this._digits = _digits;
            this._trim();
            return;
        }
        if (x === undefined || x == 0) {
            this._digits = [];
            return;
        }

        let digits = [];
        const typ = Object.prototype.toString.call(x);
        switch (typ) {
        case "[object String]":
            for (let i = 0; i < x.length; i += AddrJSDigits) {
                let end = x.length - i;
                let start = end - AddrJSDigits;
                if (start < 0) start = 0;
                const part = x.substring(start, end);
                digits.push(parseInt(part, 16));
            }
            break;
        case "[object Number]":
            const mask = (1<<AddrJSBits) - 1;
            while (x > 0) {
                digits.push(x & mask);
                x = x >> AddrJSBits;
            }
            break
        default:
            throw "not a string or number";
        }
        this._digits = digits;
    }

    _trim() {
        const d = this._digits;
        while (d.length > 0 && d[d.length-1] == 0)
            d.pop();
    }

    toString() {
        const d = this._digits;
        if (d.length == 0)
            return "0";
        let i = d.length - 1;
        let out = d[i].toString(16);
        for (i--; i >= 0; i--)
            out += d[i].toString(16).padStart(AddrJSDigits, "0");
        return out;
    }

    toNumber() {
        let n = 0, shift = 0;
        for (let digit of this._digits) {
            n += digit << shift
            shift += AddrJSBits;
        }
        return n;
    }

    // compare returns -1 if this < b, 0 if this == b, and 1 if this > b.
    compare(b) {
        const x = this._digits, y = b._digits;
        if (x.length < y.length)
            return -1;
        if (x.length > y.length)
            return 1;
        for (let i = x.length - 1; i >= 0; i--) {
            if (x[i] < y[i])
                return -1;
            if (x[i] > y[i])
                return 1;
        }
        return 0;
    }

    // add return this + b as a new AddrJS value.
    add(b) {
        const x = this._digits, y = b._digits;
        const digits = Math.max(x.length, y.length);

        let carry = 0;
        let out = [];
        for (let i = 0; i < digits; i++) {
            let o = (x[i] || 0) + (y[i] || 0) + carry;
            carry = o >> AddrJSBits;
            o = o & ((1 << AddrJSBits) - 1);
            out.push(o);
        }
        out.push(carry);

        return new AddrJS(undefined, out);
    }

    // sub return this - b as a new AddrJS value.
    sub(b) {
        const x = this._digits, y = b._digits;
        const digits = Math.max(x.length, y.length);

        let borrow = 0;
        let out = [];
        for (let i = 0; i < digits; i++) {
            let xx = x[i] || 0;
            let yy = (y[i] || 0) + borrow;
            borrow = (xx < yy) + 0;
            xx += borrow<<AddrJSBits;
            out.push(xx - yy);
        }
        if (borrow)
            throw("negative result");
        return new AddrJS(undefined, out);
    }
}

class Panels {
    constructor(container) {
        this._c = $("<div>").css({position: "relative", height: "100%", display: "flex"});
        this._c.appendTo(container);
        this._cols = [];
    }

    // addCol adds a column to the right and returns a container
    // element.
    addCol() {
        const div = $("<div>").css({
            overflow: "auto", height: "100%", boxSizing: "border-box",
            padding: "8px", flex: "1",
        });
        if (this._cols.length >= 0) {
            div.css({borderLeft: "2px solid #888"});
        }
        this._c.append(div);
        this._cols.push({div: div});
        return div[0];
    }
}

function scrollTo(container, elt) {
    $(container).animate({
        scrollTop: $(elt).position().top
    }, 500);
}

var asmView;
var sourceView;
var hexView;
var baseAddr;

function render(container, info) {
    const panels = new Panels(container);
    if (info.HexView)
        hexView = new HexView(info.HexView, panels.addCol());
    if (info.AsmView)
        asmView = new AsmView(info.AsmView, panels.addCol());
    if (info.SourceView)
        sourceView = new SourceView(info.SourceView, panels.addCol());

    baseAddr = new AddrJS(info.Base);

    window.addEventListener("hashchange", onHashChange, false);
    $.fx.off = true;  // Inhibit scrolling animations during setup.
    onHashChange();
    $.fx.off = false;
}

function onHashChange() {
    let hash = window.location.hash;
    if (onHashChange.lastHash === hash)
        return;
    onHashChange.lastHash = hash;
    if (hash != "" && hash != "#") {
        hash = hash.substr(1);  // Trim "#"
        const relative = hash[0] == "+";
        if (relative)
            hash = hash.substr(1);
        const ranges = parseRanges(hash);
        if (relative) {
            for (let r of ranges) {
                r[0] = r[0].add(baseAddr);
                r[1] = r[1].add(baseAddr);
            }
        }
        highlightRanges(ranges, null);
    }
}

function highlightRanges(ranges, cause) {
    if (hexView)
        hexView.highlightRanges(ranges, cause !== hexView);
    if (asmView)
        asmView.highlightRanges(ranges, cause !== asmView);
    if (sourceView)
        sourceView.highlightRanges(ranges, cause !== sourceView);

    const newHash = "#" + formatRanges(ranges);
    onHashChange.lastHash = newHash; // Inhibit hashchange listener
    window.location.hash = newHash
}

function formatRanges(ranges) {
    let out = "";
    for (let r of ranges) {
        if (out.length > 0)
            out += ","
        out += r[0].toString() + "-" + r[1].toString();
    }
    return out;
}

function parseRanges(ranges) {
    const out = [];
    for (let r of ranges.split(",")) {
        const parts = r.split("-", 2);
        out.push([new AddrJS(parts[0]), new AddrJS(parts[1])]);
    }
    return out;
}

function renderLiveness(info, insts, table, rows) {
    const ptrSize = info.PtrSize;

    // Decode live bitmaps.
    const locals = [], args = [];
    for (const bm of info.Locals)
        locals.push(parseBitmap(bm));
    for (const bm of info.Args)
        args.push(parseBitmap(bm));

    // Compute varp/argp and covered range.
    var liveMin = 0xffffffff;
    var liveMax = 0;
    var argMin = 0xffffffff;
    var argMax = 0;
    const iextra = []; // Extra per-instruction info
    for (let i = 0; i < insts.length; i++) {
        const spoff = info.SPOff[i];
        iextra[i] = {
            varp: info.VarpDelta + spoff,
            argp: info.ArgpDelta + spoff,
        };

        // SPOff -1 indicates unknown SP offset. SPOff 0 happens at
        // RET, where we don't bother resetting the liveness index,
        // but if the frame is 0 bytes, it can't have liveness.
        if (spoff <= 0)
            continue;

        const index = info.Indexes[i];
        if (index < 0)
            continue;
        if (iextra[i].varp > 0) {
            iextra[i].localp = iextra[i].varp - locals[index].n * ptrSize;
            liveMin = Math.min(liveMin, iextra[i].localp);
            liveMax = Math.max(liveMax, iextra[i].varp);
        }
        if (iextra[i].argp > 0) {
            argMin = Math.min(argMin, iextra[i].argp);
            argMax = Math.max(argMax, iextra[i].argp + args[index].n * ptrSize);
        }
    }
    const haveArgs = argMin < argMax;

    // Create table header.
    if (liveMin < liveMax)
        table.groupHeader.append($("<th>").text("locals").addClass("flag").attr("colspan", (liveMax - liveMin) / ptrSize));
    if (haveArgs) {
        table.groupHeader.append($("<th>"));
        table.groupHeader.append($("<th>").text("args").addClass("flag").attr("colspan", (argMax - argMin) / ptrSize));
    }

    for (let i = liveMin; i < liveMax; i += ptrSize)
        table.header.append($("<th>").text("0x"+i.toString(16)).addClass("flag"));
    if (haveArgs) {
        table.header.append($("<th>").text("|").addClass("flag"));
        for (let i = argMin; i < argMax; i += ptrSize)
            table.header.append($("<th>").text("0x"+i.toString(16)).addClass("flag"));
    }

    // Create table cells.
    for (var i = 0; i < rows.length; i++) {
        const row = rows[i];
        const index = info.Indexes[i];
        const addBit = function(addr, bitmap, base) {
            const i = (addr - base) / ptrSize;
            var text = "";
            if (bitmap !== undefined && 0 <= i && i < bitmap.n)
                text = bitmap.bit(i) ? "P" : "-";
            row.elt.append($("<td>").text(text).addClass("flag"));
        };
        for (let addr = liveMin; addr < liveMax; addr += ptrSize)
            addBit(addr, locals[index], iextra[i].localp);
        if (haveArgs) {
            row.elt.append($("<td>"));
            for (let addr = argMin; addr < argMax; addr += ptrSize)
                addBit(addr, args[index], iextra[i].argp);
        }
    }
}

function Bitmap(nbits, bytes) {
    this.n = nbits;
    this.bytes = bytes;
}

Bitmap.prototype.bit = function(n) {
    if (n < 0 || n >= this.nbits)
        throw "out of range";
    return (this.bytes[Math.floor(n/8)]>>(n%8)) & 1;
};

function parseBitmap(bitmap) {
    // Parse hex representation.
    const parts = bitmap.split(":", 2);
    const nbits = parseInt(parts[0], 10);
    const bytes = [];
    for (var i = 0; i < parts[1].length; i += 2) {
        bytes.push(parseInt(parts[1].substr(i, 2), 16));
    }
    return new Bitmap(nbits, bytes);
}
