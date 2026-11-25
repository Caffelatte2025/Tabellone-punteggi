# Formato FARO FLS (Focus S70, cartella grezza dalla SD): cosa è stato decifrato

Analisi di `D:\Scans\add_000.fls`, 25/11/2026. Gli script di questa cartella sono stati usati per l'analisi (Node, nessuna dipendenza).

## 1. Struttura della cartella

Non è un contenitore OLE2: è una cartella di file normali.

| File | Dimensione | Contenuto |
|---|---|---|
| `Main` | 93 KB | testo, metadati completi (vedi §2) |
| `Scans/1/ScanDataStream0` | 64 MB | stream di pacchetti: punti (`$CSE$`), GPS, inclinometro, foto |
| `Scans/1/ScanDataStream1`, `2` | 64 + 59 MB | quasi solo foto JPEG (`$COO$`) |
| `Scans/1/ScanlineIndex` | 62 KB | 2581 voci da 24 byte: (tempo ms, 0, offset in ScanDataStream0) per ogni giro dello specchio |
| `Scans/1/MirrorIndex0.hls`, `1.hls` | 34 KB | tabella di 2135 righe: (passo encoder, angolo verticale in rad, double) per metà 0 e 1 |
| `Scans/1/Calib`, `Params`, `Log` | | calibrazione (binaria con intestazione testo), parametri, log testuale |
| `Scans/1/Dist0/1`, `Grey0/1`, `*.hls` | < 60 byte | solo intestazioni vuote (`Scan2DataBase { }`); i `.hls` sono gzip con `DataRect` |
| `Previews/*.jpg`, `ReferencePicture*` | 7 MB | JPEG |
| `SHA256SUM`, `.sig`, `.sha`, `Signature` | | hash e firme |

## 2. Metadati (`Main`, testo leggibile)

Elementi `Attr<tipo> { Name ... Value ... }` annidati. Valori utili per add_000:
NumRows 2135, NumCols 5160, RowStartAngle 1.5708, RowEndAngle −1.0472 (da +90° a −60°), ColEndAngle 2π,
ScannerModel FOCUS_S_70, matricola, ScanDistFactor, StorageDistFact 10000,
**GPSNMEA** (frasi NMEA complete: lat. 38°11.4096'N, long. 13°20.5443'E, quota 24,5 m),
**InclinometerField** (Theta 0.02198, Phi 0.3279 rad, bias e temperature), ScanAxis/ScanAngle, data e ora, nome della commessa.

## 3. Stream di pacchetti (`ScanDataStream*`)

Pacchetto = `u32 tempo` · `u16 flag` (0x21 / 0x121) · tag di 5 caratteri `$XXX$` · `u16 lunghezza` · dati · 1 byte di padding se la lunghezza totale è dispari.
Tutti e tre gli stream si leggono da cima a fondo senza errori.

Tipi principali: `$MIF$` (inizio di ogni giro dello specchio, 2581 giri), `$CSE$` (dati dei punti, 46,6 MB, lunghezze multiple di 16),
`$GRV$` (anteprima dell'intensità a 8 bit, 2560 valori ogni due giri), `$COO$` (JPEG della fotocamera), `$GPS$` (NMEA), `$INC$`, `$ENC$`, `$IND$`, `$CMP$`, `$TMP$` e altri.

## 4. Geometria

Ogni giro dello specchio produce 5120 campioni (un campione ogni 16 passi su 81920). La riga r è un campione di una delle due metà:

- metà 0: encoder 40880 − 16r (da +90° a −60°), colonne 0–2579;
- metà 1: encoder 40896 + 16r, colonne 2580–5159 (dall'altra parte, con azimut + π);
- i campioni con encoder < 6736 o > 75040 sono il basamento, coperto dallo scanner stesso.

Angolo verticale: tabella `MirrorIndex`. Angolo orizzontale: colonna × 2π/5160.

## 5. Codifica dei punti grezzi (`$CSE$`): DECIFRATA (implementata in `src/io/fls.js`)

1. Per ogni giro si concatenano i payload `$CSE$` dopo il `$MIF$` e **ogni blocco da 16 byte va capovolto** (è un registro a 128 bit salvato little-endian; l'ultimo blocco ha il padding di zeri in fondo).
2. Ne escono esattamente **5120 campioni per giro**, ognuno fatto di due campi a codici di prefisso (MSB per primo, big-endian):
   - **campo A** (fase/distanza): `01`+6 bit (1 byte), `10`+14 bit (2 byte), `11`+22 bit (3 byte), `00x1`+28 bit (4 byte, 30 bit con segno). È un delta con segno sommato a un accumulatore modulo 2^24, che prosegue da un giro all'altro. **Distanza = (A & 0x7FFFFF) × ScanDistFactor [mm]**. Il bit 23 cambia a ogni codice a 4 byte e va ignorato.
   - **campo B** (ampiezza/intensità): `00f`+5 bit (delta), `10f`+13 bit (delta), `11x`+13 bit (valore assoluto, a inizio giro). Il bit f vale 1 quasi solo su campioni di rumore, quindi si usa come filtro. L'anteprima `$GRV$` ≈ 0,069 × B − 18.
3. Geometria: campione k → encoder 16k. Metà 0 riga r ↔ 40880 − 16r; metà 1 ↔ 40896 + 16r. Angolo verticale da `MirrorIndex`, azimut = −colonna × 2π/NumCols (metà 1: + π).
   L'ordine delle colonne coincide con il panorama di SCENE: rotazione oraria vista dall'alto.
4. Livellamento con `ScanAxis`/`ScanAngle` (rotazione di −ScanAngle attorno all'asse). Verificato registrando add_000/add_001: lo scarto scende da 61 a 48 mm.
5. Filtro rumore: si scarta il campione se f = 1 o se differisce dai due campioni vicini della stessa colonna più di 2 cm + 2%.

Verifiche: la scena è riconoscibile, una persona a 3,2 m risulta alta circa 1,75 m, il pavimento sta circa 1,3–1,6 m sotto lo scanner. Le 7 stazioni add_000…006 si registrano in sequenza con scarto di 48–64 mm a voxel di 5 cm (`test/fls.mjs`).

Non applicato: la calibrazione fine FARO (`Calib`, compensazioni in base alla riflettività, correzione dei salti). Effetto previsto di qualche millimetro, irrilevante per la registrazione in campo; per il rilievo definitivo resta il passaggio in ufficio.

### 5b. Cosa contengono davvero i dati grezzi (dai nomi delle classi in `FL.FocusScanData.2.0.dll` di SCENE)

`FLS::FocusRawDataRead::ScanDataDecompression`, `ScanlineParser`/`ScanlineParserV2::processScanPt`, `ScanPtHwStage0`/`Stage1`,
`ScanPtPhaseToDistV5`, `PhaseSpecificJumpCorrection`, `ReflBasedPhase1DistCompensation`, `SensorFieldPhaseShift`.

I pacchetti `$CSE$` contengono **fasi** del segnale (scanner a differenza di fase), non distanze. La distanza nasce da: decompressione, poi passaggio da fase a distanza (algoritmo V5, con risoluzione dell'ambiguità tra le frequenze), correzione dei salti e compensazione in base alla riflettività, usando la calibrazione dello strumento (`Calib`, `Params`).

Nell'app servono quindi due passi:
1. decomprimere `$CSE$`;
2. un modello fase → distanza, ricavabile confrontando le fasi con le distanze del file elaborato da ReCap (§6). Per la registrazione in campo bastano pochi millimetri di precisione.

Le funzioni non sono esportate (ci sono solo i nomi RTTI) e sul PC non c'è un disassemblatore.

## 6. Riferimento: FLS elaborato prodotto da ReCap

`C:\Program Files\Autodesk\Autodesk ReCap\AdskFaroConverter.exe --parse <cartella.fls> <cartella di uscita>`
crea `WorkspaceData\temp\Scans\<nome>.fls`, in formato OLE2 compound (lettore in `cfb.mjs`). Contiene `Scans/1/Dist0`, `Dist1`, `Grey0`, `Grey1`:
gzip senza trailer (va usato `Z_SYNC_FLUSH`), un'intestazione di testo e poi **un varint LEB128 per punto**, colonna per colonna (2135 righe × 2580 colonne per metà).

- Distanza: valori ≥ 2^17 sono assoluti; gli altri sono residui zigzag rispetto al predittore mediano (LOCO-I) su sopra, sinistra e sopra-sinistra. Lo 0 vale "residuo nullo".
  La scena ricostruita è riconoscibile, ma restano artefatti a blocchi. Unità probabile 1e-5 m (da confermare), maschera dei punti non validi non ancora trovata.
- Intensità: residui, ma il predittore non è ancora identificato. Il migliore finora è la media zigzag modulo 2048, che però non è esatto.

Gli angoli e la geometria sono gli stessi del formato grezzo, quindi i valori elaborati servono come verità per decifrare `$CSE$`.
