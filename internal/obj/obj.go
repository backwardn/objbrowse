// Copyright 2018 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package obj

import (
	"debug/dwarf"
	"fmt"
	"io"

	"github.com/aclements/objbrowse/internal/arch"
)

// Mem represents a sparse memory map.
type Mem interface {
	// Data returns the data at ptr in the memory map. If size
	// exceeds the size of the data at ptr, the result will be
	// smaller than size. If ptr isn't in the memory map at all,
	// the result will be nil.
	Data(ptr, size uint64) ([]byte, error)
}

type Obj interface {
	Mem
	Info() ObjInfo
	Symbols() ([]Sym, error)
	SymbolData(s Sym) ([]byte, error)
	DWARF() (*dwarf.Data, error)
}

type ObjInfo struct {
	// Arch is the machine architecture of this object file, or
	// nil if unknown.
	Arch *arch.Arch
}

type Sym struct {
	Name        string
	Value, Size uint64
	Kind        SymKind
	Local       bool
	section     int
}

type SymKind uint8

const (
	SymUnknown SymKind = '?'
	SymText            = 'T'
	SymData            = 'D'
	SymROData          = 'R'
	SymBSS             = 'B'
	SymUndef           = 'U'
)

// Open attempts to open r as a known object file format.
func Open(r io.ReaderAt) (Obj, error) {
	if f, err := openElf(r); err == nil {
		return f, nil
	}
	if f, err := openPE(r); err == nil {
		return f, nil
	}
	return nil, fmt.Errorf("unrecognized object file format")
}
