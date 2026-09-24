package main

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

func TestSichererName(t *testing.T) {
	for ein, aus := range map[string]string{
		"../../etc/passwd":                "passwd",
		"Exposé Musterstadt.pdf":          "Exposé Musterstadt.pdf",
		"..\\..\\boot.ini":                "boot.ini",
		"a/b/<script>.pdf":                "_script_.pdf",
		strings.Repeat("x", 300) + ".pdf": strings.Repeat("x", 116) + ".pdf",
	} {
		if got := sichererName(ein); got != aus {
			t.Errorf("sichererName(%q) = %q, erwartet %q", ein, got, aus)
		}
	}
}

func TestGruppenname(t *testing.T) {
	g := gruppenAusEnv("Objekte Immo,  Zweite  Gruppe ")
	if !g[normiereName("objekte   IMMO")] || !g["zweite gruppe"] || g["objekte"] {
		t.Fatalf("Gruppenabgleich falsch: %v", g)
	}
}

func TestTextUndMedien(t *testing.T) {
	if textVon(&waE2E.Message{Conversation: proto.String("Hallo")}) != "Hallo" {
		t.Fatal("Text")
	}
	m := &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{FileName: proto.String("Exposé.pdf"), Caption: proto.String("Neues Objekt"), Mimetype: proto.String("application/pdf")}}
	art, name, med := medienVon(m)
	if art != "dokument" || name != "Exposé.pdf" || med == nil || textVon(m) != "Neues Objekt" {
		t.Fatalf("Dokument: %s %s %v", art, name, med)
	}
	ort := textVon(&waE2E.Message{LocationMessage: &waE2E.LocationMessage{DegreesLatitude: proto.Float64(50.1), DegreesLongitude: proto.Float64(9.9), Address: proto.String("Musterstadt")}})
	if !strings.Contains(ort, "50.100000, 9.900000") || !strings.Contains(ort, "Musterstadt") {
		t.Fatalf("Standort: %s", ort)
	}
	if e := endungFuer("audio/ogg; codecs=opus", ""); e != ".opus" {
		t.Fatalf("Endung: %s", e)
	}
	if e := endungFuer("application/pdf", "Mappe.PDF"); e != ".pdf" {
		t.Fatalf("Endung: %s", e)
	}
}

func TestSpeicher(t *testing.T) {
	storeDir = t.TempDir()
	sp, err := oeffneSpeicher(filepath.Join(storeDir, "n.db"))
	if err != nil {
		t.Fatal(err)
	}
	n := Nachricht{ID: "A1", Chat: "123@g.us", Absender: "49170", AbsenderName: "Max", Zeit: time.Unix(1790000000, 0), Text: "Erst", Art: "text"}
	if neu, err := sp.speichere(n); !neu || err != nil {
		t.Fatal("erste Speicherung", err)
	}
	if neu, _ := sp.speichere(n); neu {
		t.Fatal("doppelt gespeichert")
	}
	_ = sp.bearbeite("A1", "123@g.us", "Korrigiert")
	var text string
	var bearbeitet int
	_ = sp.db.QueryRow("SELECT text, bearbeitet FROM nachrichten WHERE id='A1'").Scan(&text, &bearbeitet)
	if text != "Korrigiert" || bearbeitet != 1 {
		t.Fatalf("Bearbeiten: %q %d", text, bearbeitet)
	}
	_ = sp.loesche("A1", "123@g.us")
	var anzahl int
	_ = sp.db.QueryRow("SELECT COUNT(*) FROM nachrichten").Scan(&anzahl)
	if anzahl != 0 {
		t.Fatal("Löschen")
	}
}
