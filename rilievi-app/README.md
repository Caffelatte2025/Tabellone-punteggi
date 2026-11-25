# Rilievi – registrazione delle scansioni in campo

App per tablet Android (Huawei MatePad 11) che importa le scansioni del FARO Focus S70,
le decima, le registra una dopo l'altra mentre si rileva e mostra la nuvola unita.

## Stato
- Formati letti: **FARO FLS grezzo** (cartella .fls come la scrive il Focus sulla SD, pulsante «Cartella FLS»), **E57**, PLY, PTS/XYZ. LGS: non ancora.
  Il formato FLS è stato ricostruito senza SDK FARO: vedi `tools/fls-analisi/FLS-formato.md`.
- Registrazione: ricerca automatica della posizione in pianta (correlazione FFT su una fascia orizzontale)
  + affinamento ICP punto-piano. Con scansioni livellate stima solo rotazione in pianta + spostamento.
- Allineamento manuale in pianta: un dito sposta, due dita ruotano, pulsanti ±1°/±10°.
- Progetti e stazioni salvati sul tablet (IndexedDB), anche offline.
- Esportazione: nuvola unita decimata (PLY) + matrici delle stazioni (JSON/CSV).
- Da fare: colore dalle foto della fotocamera (FLS), lettore LGS, scaricamento automatico dalla SD Wi-Fi.

## Sviluppo
```
npm install
npm run dev            # http://localhost:5173
node test/pipeline.mjs <cartella con st1.e57… e truth.json>
node test/fls.mjs D:/Scans/add_000.fls D:/Scans/add_001.fls [--png=pianta.png]
```
L'APK viene compilato da GitHub Actions (`.github/workflows/rilievi-apk.yml`) ad ogni push sul branch.
