# Rilievi – registrazione delle scansioni in campo

App per tablet Android (Huawei MatePad 11) che importa le scansioni del FARO Focus S70,
le decima, le registra una dopo l'altra mentre si rileva e mostra la nuvola unita.

## Stato
- Formati letti: **E57**, PLY, PTS/XYZ. **LGS: non ancora**, servono file di esempio da decodificare.
- Registrazione: ricerca automatica della posizione in pianta (correlazione FFT su una fascia orizzontale)
  + affinamento ICP punto-piano. Con scansioni livellate stima solo rotazione in pianta + spostamento.
- Allineamento manuale in pianta: un dito sposta, due dita ruotano, pulsanti ±1°/±10°.
- Progetti e stazioni salvati sul tablet (IndexedDB), anche offline.
- Esportazione: nuvola unita decimata (PLY) + matrici delle stazioni (JSON/CSV).
- Da fare: lettore LGS, scaricamento automatico dalla SD Wi-Fi.

## Sviluppo
```
npm install
npm run dev            # http://localhost:5173
node test/pipeline.mjs <cartella con st1.e57… e truth.json>
```
L'APK viene compilato da GitHub Actions (`.github/workflows/rilievi-apk.yml`) ad ogni push sul branch.
