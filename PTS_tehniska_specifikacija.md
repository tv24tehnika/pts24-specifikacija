# PTS — Pārvietojamā televīzijas stacija
## Tehniskā specifikācija un pakalpojumu piedāvājums

> **PTS 24** piedāvā profesionālu daudzkameru video producēšanu izbraukuma apstākļos — sporta sacensībām, koncertiem, konferencēm, korporatīvajiem un kultūras pasākumiem. Risinājums ir **modulārs**: bāzes komplekts nodrošina pilnvērtīgu raidījuma producēšanu, bet papildu moduļi ļauj mērogot tehniku atbilstoši konkrētā pasākuma apjomam.

**Dokumenta versija:** v1.0 · darba versija
**Sagatavots:** `[datums]`
**Kontaktpersona:** `[vārds, uzvārds]` · `[e-pasts]` · `[tālrunis]`

---

## 1. Vispārējs apraksts

PTS ir pilnībā aprīkota mobilā producēšanas vienība, kas spēj uztvert, komutēt, ierakstīt, grafiski papildināt un pārraidīt video signālu reāllaikā. Sistēma būvēta uz nozares standarta SDI infrastruktūras, pilnībā saderīga ar HD un 4K darbplūsmām, un atbilst EBU raidorganizāciju kvalitātes prasībām.

Galvenās iespējas:

- Daudzkameru režija ar tīru un ISO (atsevišķo kameru) ierakstu
- Reāllaika grafika — rezultātu tablo, titri, sastāvi, reklāmu integrācija
- Tiešraides pārraide internetā un uz raidorganizācijas studiju
- Profesionāli skaņu režijas un komentētāju risinājumi
- Pilna iekšējā sakaru sistēma (intercom) starp visiem darbiniekiem

---

## 2. Tehniskie pamatparametri

| Parametrs | Specifikācija |
|---|---|
| Video standarts | HD 1080i50 / 1080p50, UHD 2160p50 |
| Signāla saskarne | 12G-SDI (līdz UHD pa vienu kabeli), 3G-SDI HD ražojumiem |
| Krāsu telpa | Rec. 709 (HD), Rec. 2020 (UHD, opcija) |
| Audio | Iegults SDI audio + atsevišķs balanss; atbilstība **EBU R128 / R103** skaļuma normām |
| Ieraksta formāti | XDCAM MXF, ProRes, H.264/H.265 |
| Sinhronizācija | Genlock (Black Burst / Tri-Level Sync), centralizēta atsauce |
| Kadrēšanas atsauce | EBU R95 drošās zonas grafikai |

---

## 3. Bāzes komplekts

Standarta konfigurācija pilnvērtīgam daudzkameru raidījumam ar pārraidi.

### 3.1 Video komutācija un režija
- **Blackmagic ATEM 4 M/E Constellation 4K** — 40 × 12G-SDI ieejas, 4 M/E bankas, līdz 16 augšuplīmeņa atslēgām (keyers), DVE un SuperSource kompozīcija
- **Blackmagic ATEM 1 M/E Advanced Panel 20** — profesionāla aparatūras režijas pults ar avotu taustiņiem, T-stieni un pāreju vadību ātrai, precīzai komutācijai tiešraidē
- Iebūvēts daudzlogu (multiview) monitorings un Fairlight audio mikseris
- Programmas / priekšskata izvade uz režijas monitoriem

### 3.2 Kameras
- **8 × Grass Valley sistēmas kameras** — 4 × **LDX 92** + 4 × **LDX 110** ar **XCU** bāzes stacijām un **CGP500** vadības paneļiem
- **6 × BirdDog X5 Ultra** PTZ kameras
- Līdz **12 × Panasonic AG-CX350** kompaktās kameras
- Bezvadu RF risinājumi — **DJI** un **Teradek**
- SMPTE optiskā šķiedra starp sistēmas kameru un bāzes staciju (video, atgriezeniskais signāls, tally, intercom, barošana)
- Centralizēta krāsu un diafragmas vadība (shading) no režijas; super slow-motion atbalsts

### 3.3 Audio
- **Behringer X32 Compact** digitālā skaņu režijas pults ar daudzkanālu miksēšanu
- Digitālais **stagebox** (AES50) — mikrofonu pieslēgumi pasākuma vietā ar vienu kabeli līdz režijai
- Iegultā SDI audio apstrāde un balansēšana
- Skaļuma kontrole atbilstoši **EBU R128**
- Atskaņas (monitoring) izvades

### 3.4 Ieraksts
- **Blackmagic HyperDeck** ierakstītāji — programmas ieraksts + taimkods
- **EVS** atkārtojumu sistēma (lēnā kustība)
- ISO (atsevišķo kameru) ieraksts, maršrutējot signālus caur Videohub aux izvadēm
- Ieraksta kanālu skaits: `[precizējams]`

### 3.5 Grafika
- **CasparCG** un **vMix** grafikas serveri ar HTML šabloniem
- Rezultātu tablo (scorebug), apakšējie titri (lower thirds), sastāvi, gala rezultāts
- Pielāgojama klienta zīmola dizaina sistēma (logo, krāsas, fonti)
- Drošo zonu ievērošana atbilstoši EBU R95

### 3.6 Signāla pārraide / straumēšana
- **LiveU LU600** — apvienota mobilo tīklu (bonded cellular) augšuplāde
- **Starlink** — satelīta interneta savienojums
- **Blackmagic WebPresenter HD** — tieša straumēšana uz platformām (YouTube, Facebook, RTMP)
- Pārraide uz raidorganizācijas studiju

### 3.7 Sakari (intercom)
- **GreenGo** digitālā intercom sistēma — vadu un **bezvadu**
- Sadalītas sakaru grupas (režija, kameras, skaņa, producents)
- **Grass Valley CCS-ONE** tally sistēma (iekļauta bāzē)
- Komentētāju pieslēgvietas (iepriekš saskaņojot)

### 3.8 Maršrutēšana, vadība un infrastruktūra
- **Blackmagic Videohub 40×40** SDI maršrutēšanas matrica — elastīga signālu sadale starp kamerām, switcheri, ierakstu un izvadēm
- **Raspberry Pi + Bitfocus Companion + Stream Deck XL** — centralizēta tehnikas vadība un automatizācija
- **PoE pārvaldāms tīkla komutators** (DigiSwitch) visai IP infrastruktūrai
- Barošanas sadale ar pārsprieguma aizsardzību un UPS kritiskajām iekārtām

---

## 4. Papildu moduļi (opcijas)

Bāzes komplekts paplašināms ar šādiem moduļiem atkarībā no pasākuma:

### 4.1 Kameras

| Modulis | Apraksts |
|---|---|
| Papildu kameras | Vēl LDX 92 / LDX 110, BirdDog X5 Ultra PTZ vai Panasonic CX350 |
| Bezvadu RF kamera | DJI un Teradek risinājumi mobilam attēlam (sporta laukumam, skatuvei) |
| Kameras krāns | **ABC krāns**, 8 m sniedzamība |
| Dolly sistēma | **Super Panther 3** — sliede līdz 32 m, pilns aplis Ø6 m diametrā |

### 4.2 Atkārtojumi un grafika

| Modulis | Apraksts |
|---|---|
| Atkārtojumi | **EVS** lēnās kustības atkārtojumu sistēma |
| Paplašināta grafika | Papildu CasparCG / vMix kanāli, datu integrācija (rezultātu OCR, sastāvu importēšana) |

### 4.3 Audio

| Modulis | Apraksts |
|---|---|
| Komentētāju pozīcijas | Komentētāju vietas ar mikrofonu un atskaņu — **iepriekš saskaņojot** |
| Bezvadu mikrofoni | Roku / atloka bezvadu komplekti |
| Lauka skaņa | Papildu mikrofoni vides / ambiences ierakstam |

### 4.4 Pārraide

| Modulis | Apraksts |
|---|---|
| Dublējošs uplink | Otrs LiveU, Starlink vai šķiedras kanāls augstai drošībai |
| Multi-language straumēšana | Vairākas vienlaicīgas straumes ar dažādiem komentāriem |

### 4.5 Loģistika un apgaismojums

| Modulis | Apraksts |
|---|---|
| Palīgtransports | Papildu transports ar piekabi tehnikas pārvadāšanai |
| Studijas / intervijas gaismas | LED gaismu komplekts intervijām vai studijai uz vietas |

---

## 5. Tehniskā komanda

Bāzes komplektā iekļautā komanda:

- Tehniskais producents / režisors
- Video tehniķis (vīzija / komutācija)
- Skaņu režisors
- Kameru operatori (atbilstoši kameru skaitam)
- Grafikas operators

Papildu personāls (komentētāju atbalsts, replay operators, papildu kameru operatori) pēc nepieciešamības.

---

## 6. Loģistika un prasības

| Prasība | Specifikācija |
|---|---|
| Uzstādīšanas laiks | `[X]` h pirms pasākuma (atkarībā no apjoma) |
| Demontāža | `[X]` h pēc pasākuma |
| Barošana | `[X]` kW, `[X]` × 230V / 16A vai 3 fāzu pieslēgums |
| Telpa režijai | `[X]` m² aizsargāta no nokrišņiem / PTS busam piekļuve |
| Nepieciešamā vieta | 9 m garumā (transportlīdzeklis + darba zona ar markīzi) |
| Tīkls / internets | Mobilais pārklājums LiveU augšuplādei vai dedicated šķiedra |
| Piekļuve | Transportlīdzekļa piebraukšana izkraušanai |

---

## 7. Cenu struktūra

> Cenas norādītas kā vietturi (`placeholder`) — precizējamas atkarībā no pasākuma apjoma, ilguma un norises vietas.

### Bāzes komplekts

| Pozīcija | Vienība | Cena |
|---|---|---|
| Bāzes PTS komplekts (8 × GV sistēmas kameras (LDX 92 + LDX 110), ATEM 4 M/E Constellation 4K, Videohub 40×40, X32 Compact, pilna režija) | dienā | `[€ XXX]` |
| Papildu producēšanas diena | dienā | `[€ XXX]` |
| Uzstādīšanas / demontāžas diena | dienā | `[€ XXX]` |

### Papildu moduļi

| Modulis | Vienība | Cena |
|---|---|---|
| Papildu sistēmas kamera (LDX) + operators | dienā | `[€ XXX]` |
| Papildu kamera (PTZ / CX350) + operators | dienā | `[€ XX]` |
| Bezvadu RF kamera (DJI / Teradek) | dienā | `[€ XXX]` |
| EVS atkārtojumu sistēma | dienā | `[€ XXX]` |
| Dolly sistēma (Super Panther 3) | dienā | `[€ XXX]` |
| Kameras krāns (ABC, 8 m) | dienā | `[€ XXX]` |
| Komentētāju pozīcija | gab. | `[€ XX]` |
| Dublējošs uplink | dienā | `[€ XXX]` |
| Palīgtransports ar piekabi | dienā | `[€ XX]` |

### Papildu izmaksas

| Pozīcija | Cena |
|---|---|
| Transports / loģistika | `[€ X / km vai fiksēta likme]` |
| Komandas dienas nauda (ārpus Rīgas) | `[€ XX / persona]` |
| Nakšņošana (daudzdienu pasākumi) | `[pēc faktiskajām izmaksām]` |

---

## 8. Piezīmes un nosacījumi

- Visi signāli atbilst EBU raidorganizāciju kvalitātes standartiem (R128 skaļums, R95 drošās zonas).
- Galīgā konfigurācija un cena tiek precizēta pēc tehniskās apspriedes un norises vietas apskates.
- Piedāvājums ietver pilnu tehnisko atbalstu pasākuma laikā.
- Materiālu pēcapstrāde, montāža un arhivēšana — pēc atsevišķas vienošanās.
- PTS pieejamība apstiprināma atbilstoši grafikam.

---

*Šī ir tehniskā darba versija. Pielāgojama konkrētam klientam un pasākumam.*
