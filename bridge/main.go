// A²O WhatsApp-Bridge: hängt als verknüpftes Gerät an der Firmennummer und speichert
// NUR die Gruppen aus WA_GRUPPEN (z. B. „Objekte Immo“) — Texte sofort, Fotos, PDFs und
// Sprachnachrichten werden sofort heruntergeladen, solange die WhatsApp-Links gültig sind.
//
// Absichtlich schmal: kein Senden, kein HTTP-Server. Die Immo-Rechner-App liest nur
// STORE_DIR/nachrichten.db und STORE_DIR/medien/ (gemeinsames Docker-Volume).
// Zum Koppeln liegt der aktuelle QR-Code als STORE_DIR/qr.png bereit, den Zustand
// beschreibt STORE_DIR/status.json.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/mdp/qrterminal"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
	"rsc.io/qr"
)

var (
	storeDir = envOder("STORE_DIR", "store")
	gruppen  = gruppenAusEnv(os.Getenv("WA_GRUPPEN"))
	log      = waLog.Stdout("Bridge", envOder("LOG_LEVEL", "INFO"), false)
)

func envOder(k, standard string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return standard
}

// „Objekte Immo, Zweite Gruppe“ → normierte Namen; Groß/Klein und Emojis/Leerzeichen am Rand egal
func gruppenAusEnv(s string) map[string]bool {
	m := map[string]bool{}
	for _, g := range strings.Split(s, ",") {
		if n := normiereName(g); n != "" {
			m[n] = true
		}
	}
	return m
}

func normiereName(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(s)), " ")
}

// ── Speicher ────────────────────────────────────────────────────────────────

type Speicher struct{ db *sql.DB }

func oeffneSpeicher(pfad string) (*Speicher, error) {
	db, err := sql.Open("sqlite3", "file:"+pfad+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS gruppen (
			jid TEXT PRIMARY KEY, name TEXT, aktualisiert INTEGER
		);
		CREATE TABLE IF NOT EXISTS nachrichten (
			id TEXT NOT NULL, chat TEXT NOT NULL,
			absender TEXT, absender_name TEXT, von_mir INTEGER DEFAULT 0,
			zeit INTEGER NOT NULL, text TEXT, art TEXT,
			dateiname TEXT, mime TEXT, groesse INTEGER,
			datei TEXT, datei_status TEXT, versuche INTEGER DEFAULT 0, medien_proto BLOB,
			bearbeitet INTEGER DEFAULT 0,
			PRIMARY KEY (id, chat)
		);
		CREATE INDEX IF NOT EXISTS nachrichten_zeit ON nachrichten(chat, zeit);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return &Speicher{db: db}, nil
}

type Nachricht struct {
	ID, Chat, Absender, AbsenderName string
	VonMir                           bool
	Zeit                             time.Time
	Text, Art, Dateiname, Mime       string
	Groesse                          uint64
	MedienProto                      []byte
}

// Neue Nachricht speichern; true, wenn sie neu war (Historie kommt teils doppelt)
func (s *Speicher) speichere(n Nachricht) (bool, error) {
	status := ""
	if n.MedienProto != nil {
		status = "offen"
	}
	r, err := s.db.Exec(`INSERT INTO nachrichten
		(id, chat, absender, absender_name, von_mir, zeit, text, art, dateiname, mime, groesse, datei_status, medien_proto)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id, chat) DO NOTHING`,
		n.ID, n.Chat, n.Absender, n.AbsenderName, n.VonMir, n.Zeit.Unix(), n.Text, n.Art,
		n.Dateiname, n.Mime, n.Groesse, status, n.MedienProto)
	if err != nil {
		return false, err
	}
	k, _ := r.RowsAffected()
	return k > 0, nil
}

func (s *Speicher) bearbeite(id, chat, text string) error {
	_, err := s.db.Exec(`UPDATE nachrichten SET text = ?, bearbeitet = 1 WHERE id = ? AND chat = ?`, text, id, chat)
	return err
}

// Gelöschte Nachrichten („Für alle löschen“) auch hier entfernen, samt Datei
func (s *Speicher) loesche(id, chat string) error {
	var datei sql.NullString
	_ = s.db.QueryRow(`SELECT datei FROM nachrichten WHERE id = ? AND chat = ?`, id, chat).Scan(&datei)
	if datei.Valid && datei.String != "" {
		_ = os.Remove(filepath.Join(storeDir, datei.String))
	}
	_, err := s.db.Exec(`DELETE FROM nachrichten WHERE id = ? AND chat = ?`, id, chat)
	return err
}

func (s *Speicher) merkeGruppe(jid, name string) {
	_, _ = s.db.Exec(`INSERT INTO gruppen (jid, name, aktualisiert) VALUES (?,?,?)
		ON CONFLICT(jid) DO UPDATE SET name = excluded.name, aktualisiert = excluded.aktualisiert`,
		jid, name, time.Now().Unix())
}

// ── Nachrichten lesen ───────────────────────────────────────────────────────

// Text einer Nachricht; Standort, Kontakt und Umfrage als lesbarer Text
func textVon(m *waE2E.Message) string {
	if m == nil {
		return ""
	}
	switch {
	case m.GetConversation() != "":
		return m.GetConversation()
	case m.GetExtendedTextMessage() != nil:
		return m.GetExtendedTextMessage().GetText()
	case m.GetImageMessage() != nil:
		return m.GetImageMessage().GetCaption()
	case m.GetVideoMessage() != nil:
		return m.GetVideoMessage().GetCaption()
	case m.GetDocumentMessage() != nil:
		return m.GetDocumentMessage().GetCaption()
	case m.GetLocationMessage() != nil:
		l := m.GetLocationMessage()
		return standortText(l.GetDegreesLatitude(), l.GetDegreesLongitude(), l.GetName(), l.GetAddress())
	case m.GetLiveLocationMessage() != nil:
		l := m.GetLiveLocationMessage()
		return standortText(l.GetDegreesLatitude(), l.GetDegreesLongitude(), "Live-Standort", l.GetCaption())
	case m.GetContactMessage() != nil:
		return "👤 Kontakt: " + m.GetContactMessage().GetDisplayName() + "\n" + m.GetContactMessage().GetVcard()
	}
	for _, p := range []*waE2E.PollCreationMessage{m.GetPollCreationMessage(), m.GetPollCreationMessageV2(), m.GetPollCreationMessageV3()} {
		if p != nil {
			t := "📊 Umfrage: " + p.GetName()
			for _, o := range p.GetOptions() {
				t += "\n– " + o.GetOptionName()
			}
			return t
		}
	}
	return ""
}

func standortText(lat, lng float64, name, adresse string) string {
	t := fmt.Sprintf("📍 Standort: %.6f, %.6f (https://maps.google.com/?q=%.6f,%.6f)", lat, lng, lat, lng)
	if s := strings.TrimSpace(name + " " + adresse); s != "" {
		t += " — " + s
	}
	return t
}

type medium interface {
	whatsmeow.DownloadableMessage
	proto.Message
	GetMimetype() string
	GetFileLength() uint64
}

// Medienteil einer Nachricht: Art, Original-Dateiname, MIME, Größe und die Nachricht selbst
func medienVon(m *waE2E.Message) (art, name string, med medium) {
	switch {
	case m.GetImageMessage() != nil:
		return "bild", "", m.GetImageMessage()
	case m.GetVideoMessage() != nil:
		return "video", "", m.GetVideoMessage()
	case m.GetAudioMessage() != nil:
		return "audio", "", m.GetAudioMessage()
	case m.GetDocumentMessage() != nil:
		d := m.GetDocumentMessage()
		return "dokument", d.GetFileName(), d
	}
	return "", "", nil
}

var unsicher = regexp.MustCompile(`[^\p{L}\p{N}._ -]+`)

// Dateiname aus dem Chat nie als Pfad benutzen
func sichererName(s string) string {
	s = filepath.Base(strings.ReplaceAll(s, "\\", "/"))
	s = strings.Trim(unsicher.ReplaceAllString(s, "_"), ". ")
	if len(s) > 120 {
		ext := filepath.Ext(s)
		if len(ext) > 10 {
			ext = ""
		}
		s = s[:120-len(ext)] + ext
	}
	return s
}

func endungFuer(mimetype, name string) string {
	if e := strings.ToLower(filepath.Ext(name)); e != "" && len(e) <= 6 {
		return e
	}
	basis := strings.TrimSpace(strings.Split(mimetype, ";")[0])
	switch basis {
	case "audio/ogg":
		return ".opus"
	case "image/jpeg":
		return ".jpg"
	case "audio/mp4":
		return ".m4a"
	case "application/pdf":
		return ".pdf"
	}
	if e, _ := mime.ExtensionsByType(basis); len(e) > 0 {
		return e[len(e)-1]
	}
	return ".bin"
}

// ── Bridge ──────────────────────────────────────────────────────────────────

type Bridge struct {
	cli      *whatsmeow.Client
	sp       *Speicher
	mu       sync.Mutex
	erlaubt  map[string]bool   // Chat-JID → gehört zu WA_GRUPPEN
	namen    map[string]string // Chat-JID → Gruppenname
	geprueft map[string]time.Time
	laden    chan [2]string // (id, chat) zum Herunterladen
}

// Gehört der Chat zu einer der Gruppen? Name wird bei WhatsApp nachgefragt und 10 min gemerkt.
func (b *Bridge) istErlaubt(ctx context.Context, chat types.JID, nameHinweis string) bool {
	if chat.Server != types.GroupServer {
		return false
	}
	k := chat.String()
	b.mu.Lock()
	ok, bekannt := b.erlaubt[k]
	frisch := time.Since(b.geprueft[k]) < 10*time.Minute
	b.mu.Unlock()
	if bekannt && frisch {
		return ok
	}
	name := nameHinweis
	if info, err := b.cli.GetGroupInfo(ctx, chat); err == nil {
		name = info.Name
	} else if bekannt {
		return ok // WhatsApp gerade nicht erreichbar: bei der letzten Antwort bleiben
	}
	ok = gruppen[normiereName(name)]
	b.mu.Lock()
	b.erlaubt[k], b.namen[k], b.geprueft[k] = ok, name, time.Now()
	b.mu.Unlock()
	if ok {
		b.sp.merkeGruppe(k, name)
	}
	return ok
}

func (b *Bridge) absenderName(ctx context.Context, info types.MessageInfo) string {
	if info.PushName != "" {
		return info.PushName
	}
	if info.IsFromMe && b.cli.Store.PushName != "" {
		return b.cli.Store.PushName
	}
	for _, jid := range []types.JID{info.Sender.ToNonAD(), info.SenderAlt.ToNonAD()} {
		if jid.IsEmpty() {
			continue
		}
		if c, err := b.cli.Store.Contacts.GetContact(ctx, jid); err == nil && c.Found {
			for _, n := range []string{c.FullName, c.PushName, c.FirstName, c.BusinessName} {
				if n != "" {
					return n
				}
			}
		}
	}
	return ""
}

func (b *Bridge) verarbeite(ctx context.Context, evt *events.Message, historie bool) {
	chat := evt.Info.Chat
	if !b.istErlaubt(ctx, chat, "") {
		return
	}
	m := evt.Message
	if p := m.GetProtocolMessage(); p != nil {
		switch p.GetType() {
		case waE2E.ProtocolMessage_REVOKE:
			if err := b.sp.loesche(p.GetKey().GetID(), chat.String()); err != nil {
				log.Warnf("Löschen: %v", err)
			}
		case waE2E.ProtocolMessage_MESSAGE_EDIT:
			if err := b.sp.bearbeite(p.GetKey().GetID(), chat.String(), textVon(p.GetEditedMessage())); err != nil {
				log.Warnf("Bearbeiten: %v", err)
			}
		}
		return
	}
	if evt.IsEdit {
		return // oben als ProtocolMessage behandelt
	}
	art, name, med := medienVon(m)
	n := Nachricht{
		ID: evt.Info.ID, Chat: chat.String(), Absender: evt.Info.Sender.User,
		AbsenderName: b.absenderName(ctx, evt.Info), VonMir: evt.Info.IsFromMe,
		Zeit: evt.Info.Timestamp, Text: textVon(m), Art: "text",
	}
	if med != nil {
		roh, err := proto.Marshal(med)
		if err == nil {
			n.Art, n.Mime, n.Groesse, n.MedienProto = art, med.GetMimetype(), med.GetFileLength(), roh
			n.Dateiname = sichererName(name)
		}
	}
	if n.Text == "" && n.MedienProto == nil {
		return // Reaktionen, Sticker, Systemmeldungen
	}
	neu, err := b.sp.speichere(n)
	if err != nil {
		log.Errorf("Speichern %s: %v", n.ID, err)
		return
	}
	if neu && !historie {
		log.Infof("Neue Nachricht in „%s“ (%s)", b.namen[n.Chat], n.Art)
	}
	if neu && n.MedienProto != nil {
		select {
		case b.laden <- [2]string{n.ID, n.Chat}:
		default: // Warteschlange voll: holt der regelmäßige Durchlauf nach
		}
	}
}

// Medien herunterladen: einer nach dem anderen, bis zu 5 Versuche je Datei
func (b *Bridge) lader(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case auftrag := <-b.laden:
			b.ladeHerunter(ctx, auftrag[0], auftrag[1])
		}
	}
}

func (b *Bridge) ladeHerunter(ctx context.Context, id, chat string) {
	var art, dateiname, mimetype, status string
	var zeit int64
	var roh []byte
	err := b.sp.db.QueryRow(`SELECT art, COALESCE(dateiname,''), COALESCE(mime,''), zeit, medien_proto, COALESCE(datei_status,'')
		FROM nachrichten WHERE id = ? AND chat = ?`, id, chat).Scan(&art, &dateiname, &mimetype, &zeit, &roh, &status)
	if err != nil || status == "ok" || roh == nil {
		return
	}
	var med medium
	switch art {
	case "bild":
		med = &waE2E.ImageMessage{}
	case "video":
		med = &waE2E.VideoMessage{}
	case "audio":
		med = &waE2E.AudioMessage{}
	case "dokument":
		med = &waE2E.DocumentMessage{}
	default:
		return
	}
	if err := proto.Unmarshal(roh, med); err != nil {
		return
	}
	daten, err := b.cli.Download(ctx, med)
	if err != nil {
		log.Warnf("Download %s fehlgeschlagen: %v", id, err)
		endgueltig := errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith404) || errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith410)
		_, _ = b.sp.db.Exec(`UPDATE nachrichten SET versuche = versuche + 1,
			datei_status = CASE WHEN ? OR versuche + 1 >= 5 THEN 'fehler' ELSE 'offen' END WHERE id = ? AND chat = ?`,
			endgueltig, id, chat)
		return
	}
	ordner := filepath.Join("medien", strings.SplitN(chat, "@", 2)[0])
	datei := filepath.Join(ordner, fmt.Sprintf("%s_%s%s",
		time.Unix(zeit, 0).UTC().Format("20060102-150405"), sichererName(id), endungFuer(mimetype, dateiname)))
	if err := os.MkdirAll(filepath.Join(storeDir, ordner), 0o750); err != nil {
		log.Errorf("Ordner: %v", err)
		return
	}
	tmp := filepath.Join(storeDir, datei+".tmp")
	if err := os.WriteFile(tmp, daten, 0o640); err != nil || os.Rename(tmp, filepath.Join(storeDir, datei)) != nil {
		log.Errorf("Datei schreiben %s fehlgeschlagen", datei)
		return
	}
	_, _ = b.sp.db.Exec(`UPDATE nachrichten SET datei = ?, datei_status = 'ok', groesse = ?, medien_proto = NULL WHERE id = ? AND chat = ?`,
		filepath.ToSlash(datei), len(daten), id, chat)
}

// Alle 10 Minuten: offene Downloads nachholen
func (b *Bridge) nachholen(ctx context.Context) {
	for {
		rows, err := b.sp.db.Query(`SELECT id, chat FROM nachrichten WHERE datei_status = 'offen' ORDER BY zeit DESC LIMIT 200`)
		if err == nil {
			var offen [][2]string
			for rows.Next() {
				var a [2]string
				if rows.Scan(&a[0], &a[1]) == nil {
					offen = append(offen, a)
				}
			}
			rows.Close()
			for _, a := range offen {
				select {
				case b.laden <- a:
				case <-ctx.Done():
					return
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Minute):
		}
	}
}

func (b *Bridge) historie(ctx context.Context, h *events.HistorySync) {
	for _, conv := range h.Data.GetConversations() {
		jid, err := types.ParseJID(conv.GetID())
		if err != nil || !b.istErlaubt(ctx, jid, conv.GetName()) {
			continue
		}
		anzahl := 0
		for _, hm := range conv.GetMessages() {
			evt, err := b.cli.ParseWebMessage(jid, hm.GetMessage())
			if err != nil {
				continue
			}
			b.verarbeite(ctx, evt, true)
			anzahl++
		}
		log.Infof("Verlauf „%s“: %d Nachrichten übernommen", conv.GetName(), anzahl)
	}
}

// Beim Verbinden: Gruppen suchen, zu denen die Firmennummer gehört
func (b *Bridge) gruppenAbgleichen(ctx context.Context) []map[string]string {
	liste, err := b.cli.GetJoinedGroups(ctx)
	if err != nil {
		log.Warnf("Gruppenliste: %v", err)
		return nil
	}
	var gefunden []map[string]string
	for _, g := range liste {
		ok := gruppen[normiereName(g.Name)]
		k := g.JID.String()
		b.mu.Lock()
		b.erlaubt[k], b.namen[k], b.geprueft[k] = ok, g.Name, time.Now()
		b.mu.Unlock()
		if ok {
			b.sp.merkeGruppe(k, g.Name)
			gefunden = append(gefunden, map[string]string{"jid": k, "name": g.Name})
		}
	}
	return gefunden
}

// ── Zustand für die App ─────────────────────────────────────────────────────

var zustandMu sync.Mutex
var zustand = map[string]any{}

func setzeZustand(werte map[string]any) {
	zustandMu.Lock()
	defer zustandMu.Unlock()
	for k, v := range werte {
		zustand[k] = v
	}
	zustand["aktualisiert"] = time.Now().UTC().Format(time.RFC3339)
	daten, _ := json.MarshalIndent(zustand, "", "  ")
	tmp := filepath.Join(storeDir, "status.json.tmp")
	if os.WriteFile(tmp, daten, 0o640) == nil {
		_ = os.Rename(tmp, filepath.Join(storeDir, "status.json"))
	}
}

func schreibeQR(code string) {
	c, err := qr.Encode(code, qr.M)
	if err != nil {
		return
	}
	c.Scale = 8
	tmp := filepath.Join(storeDir, "qr.png.tmp")
	if os.WriteFile(tmp, c.PNG(), 0o640) == nil {
		_ = os.Rename(tmp, filepath.Join(storeDir, "qr.png"))
	}
}

func main() {
	if len(gruppen) == 0 {
		log.Errorf("WA_GRUPPEN ist leer — z. B. WA_GRUPPEN=\"Objekte Immo\"")
		os.Exit(2)
	}
	if err := os.MkdirAll(storeDir, 0o750); err != nil {
		log.Errorf("STORE_DIR: %v", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	container, err := sqlstore.New(ctx, "sqlite3", "file:"+filepath.Join(storeDir, "whatsapp.db")+"?_foreign_keys=on&_busy_timeout=5000", waLog.Stdout("DB", "WARN", false))
	if err != nil {
		log.Errorf("Gerätespeicher: %v", err)
		os.Exit(1)
	}
	geraet, err := container.GetFirstDevice(ctx)
	if err != nil {
		log.Errorf("Gerät: %v", err)
		os.Exit(1)
	}
	sp, err := oeffneSpeicher(filepath.Join(storeDir, "nachrichten.db"))
	if err != nil {
		log.Errorf("Nachrichtenspeicher: %v", err)
		os.Exit(1)
	}
	cli := whatsmeow.NewClient(geraet, waLog.Stdout("WhatsApp", "WARN", false))
	b := &Bridge{cli: cli, sp: sp, erlaubt: map[string]bool{}, namen: map[string]string{},
		geprueft: map[string]time.Time{}, laden: make(chan [2]string, 1000)}

	cli.AddEventHandler(func(e any) {
		switch v := e.(type) {
		case *events.Message:
			b.verarbeite(ctx, v, false)
		case *events.HistorySync:
			go b.historie(ctx, v)
		case *events.GroupInfo:
			if v.Name != nil {
				b.mu.Lock()
				delete(b.geprueft, v.JID.String())
				b.mu.Unlock()
			}
		case *events.Connected:
			_ = os.Remove(filepath.Join(storeDir, "qr.png"))
			nummer := ""
			if cli.Store.ID != nil {
				nummer = cli.Store.ID.User
			}
			setzeZustand(map[string]any{"zustand": "verbunden", "nummer": nummer, "name": cli.Store.PushName})
			go func() {
				g := b.gruppenAbgleichen(ctx)
				setzeZustand(map[string]any{"gruppen": g, "gruppeFehlt": len(g) == 0})
				if len(g) == 0 {
					log.Warnf("Die Nummer ist in keiner Gruppe namens %q", os.Getenv("WA_GRUPPEN"))
				}
			}()
		case *events.Disconnected:
			setzeZustand(map[string]any{"zustand": "getrennt"})
		case *events.LoggedOut:
			log.Warnf("Vom Telefon abgemeldet — neu koppeln nötig")
			setzeZustand(map[string]any{"zustand": "abgemeldet"})
			_ = cli.Store.Delete(context.Background())
			os.Exit(1) // Docker startet neu → neuer QR-Code
		}
	})

	go b.lader(ctx)
	go b.nachholen(ctx)

	if cli.Store.ID == nil {
		qrKanal, _ := cli.GetQRChannel(ctx)
		if err := cli.Connect(); err != nil {
			log.Errorf("Verbinden: %v", err)
			os.Exit(1)
		}
		setzeZustand(map[string]any{"zustand": "koppeln"})
		for item := range qrKanal {
			switch item.Event {
			case "code":
				schreibeQR(item.Code)
				fmt.Println("\nMit dem Firmen-Handy scannen: WhatsApp → Verknüpfte Geräte → Gerät hinzufügen")
				qrterminal.GenerateHalfBlock(item.Code, qrterminal.L, os.Stdout)
			case "success":
				log.Infof("Gekoppelt")
			default:
				log.Warnf("Koppeln: %s", item.Event)
				_ = os.Remove(filepath.Join(storeDir, "qr.png"))
				if item.Event == "timeout" {
					setzeZustand(map[string]any{"zustand": "abgelaufen"})
					os.Exit(1) // Neustart erzeugt neue QR-Codes
				}
			}
		}
	} else if err := cli.Connect(); err != nil {
		log.Errorf("Verbinden: %v", err)
		os.Exit(1)
	}

	<-ctx.Done()
	cli.Disconnect()
	sp.db.Close()
}
