# CandidateMaster

Aday hamle (candidate move) antrenörü. Taktik bulmacalar yerine gerçek oyunlardan gelen dengeli pozisyonlarda **iki güçlü fikri** seçmeyi, ardından seçimi centipawn kaybı ve Lichess doğruluk eğrisiyle ölçmeyi amaçlar.

Türkçe arayüz, koyu ve odaklı bir “minimalist Lichess / neo-brutalist” görünüm.

## Neler var?

- **Çift aday / tek hamle modu** — iki aday aynı pozisyondan seçilir; birincil tercih PV1, alternatif PV2 ile kıyaslanır.
- **2000 doğal pozisyon** — 667 açılış, 667 orta oyun, 666 oyun sonu; ilk 38 küratörlü set korunur.
- **Lichess derin verisi** — `depth ≥ 22`, mate yok, `|cp| ≤ 300`, en az 3 PV ve `PV1–PV2 ≤ 150 cp`.
- **Anlık geri bildirim** — doğruluk yüzdesi, ortalama CPL, sırasız/sıralı Top-2 eşleşmesi, hamle sınıfı.
- **Top-3 motor varyantı** — tahtada adım adım oynatma; senin hamlen de ok ile gösterilir.
- **Stockfish 19 Lite** — veri setinde olmayan adaylar tarayıcıda WASM ile değerlendirilir.
- **AI koç** — `OPENROUTER_API_KEY` varsa OpenRouter üzerinden MiniMax; yoksa aynı PV verisinden üretilen deterministik Türkçe yerel not.
- **Yerel istatistikler** — turlar, doğruluk trendi, evre bazlı başarı; veriler yalnızca `localStorage`'da.

## Kurulum

Gereksinimler: **Node.js 22+** ve npm.

```bash
npm install
npm run dev
```

Uygulama: <http://localhost:3000>

Üretim derlemesi:

```bash
npm run build
npm start
```

### Ortam değişkenleri

`.env.example` dosyasını `.env.local` olarak kopyala. Hepsi isteğe bağlıdır:

```dotenv
# Birincil sağlayıcı: OpenRouter (OpenAI uyumlu)
OPENROUTER_API_KEY=
OPENROUTER_API_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=minimax/minimax-m3.1-flash:free

# İsteğe bağlı: OpenRouter attribution ve site adresi
OPENROUTER_SITE_URL=

# Alternatif: OpenRouter anahtarı yoksa DeepSeek kullanılır
DEEPSEEK_API_KEY=
DEEPSEEK_API_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

`OPENROUTER_API_KEY` varsa OpenRouter, yoksa `DEEPSEEK_API_KEY` denenir. İkisi de yoksa `/api/explain` hata vermez; yerel koç notunu `source: "local"` ile döndürür. API anahtarı yalnızca sunucuda kalır; tarayıcıya gönderilmez.

## Vercel'e yayınlama

1. Repoyu GitHub'a push et.
2. [vercel.com/new](https://vercel.com/new) üzerinden repoyu içe aktar. Next.js otomatik algılanır; build komutu `next build`.
3. **Settings → Environment Variables** altında şunları ekle:
   - `OPENROUTER_API_KEY` (zorunlu, AI koç için)
   - `OPENROUTER_MODEL` = `minimax/minimax-m3.1-flash:free`
   - İsteğe bağlı: `OPENROUTER_SITE_URL`
4. Deploy et. API route, Stockfish WASM ve `public/data` aynı projede çalışır.

Anahtarı `.env.local` dosyasına koyup commit etme; `.gitignore` bunu engeller. Vercel'de ortam değişkeni değiştirdikten sonra yeniden deploy gerekir.

## Nasıl çalışır?

1. **Pozisyon** — Lichess Cloud Eval satırları FEN'e göre gruplanır; PV'ler sıranın perspektifinden sıralanır.
2. **Adaylar** — Tahtada tıkla–tıkla veya sürükle–bırak. Seçilen hamle veri setindeki bir PV ise doğrudan kullanılır.
3. **Eksik PV** — Aday veri setinde yoksa Stockfish 19 Lite `searchmoves` ile yalnızca o hamleyi derinleştirir.
4. **Motor da yoksa** — Statik/pozisyonel bir tahmin devreye girer ve arayüz “Kısmen yaklaşık değerlendirme” uyarısı gösterir.
5. **Skor** — Beyaz perspektifindeki `cp`, sıranın perspektifine çevrilir; kayıp ve doğruluk Lichess formülleriyle hesaplanır.
6. **Kayıt** — Tur, Top-2 isabeti ve CPL ile `localStorage`'a yazılır; İstatistikler sayfası buradan beslenir.

### Formüller

```text
Win%     = 50 + 50 × (2 / (1 + e^(−0.00368208 × cp)) − 1)
Accuracy = 103.1668 × e^(−0.04354 × ΔWin%) − 3.1669
CPL      = max(0, en iyi sıra-perspektifi cp − seçilen hamlenin sıra-perspektifi cp)
```

`ΔWin%`, en iyi hamle ile seçilen hamle arasındaki Win% farkıdır. Formül sıfır kayıpta `99.9999` verir; arayüz bunu `100%` olarak yuvarlar.

## Veri seti

Çalışma zamanındaki dosya: `public/data/curated_positions.json`.

```json
{
  "version": 1,
  "generatedAt": "2026-10-21T...",
  "source": "Lichess cloud evaluation + Lichess/chess-position-evaluations",
  "positionCount": 2000,
  "phaseCounts": { "opening": 667, "middlegame": 667, "endgame": 666 },
  "positions": [
    {
      "id": "cm-0001",
      "fen": "rn1qkb1r/... w KQkq - 2 8",
      "phase": "middlegame",
      "sideToMove": "w",
      "pieces": 30,
      "evalCp": 20,
      "gapCp": 1,
      "depth": 52,
      "knodes": 27094095,
      "pvs": [
        { "move": "d1d2", "line": "d1d2 b8d7 ...", "depth": 52, "knodes": 27094095, "cp": 20, "mate": null }
      ],
      "source": "lichess-cloud-eval",
      "label": "Sicilian Najdorf"
    }
  ]
}
```

- `cp` ve `evalCp` **beyaz perspektifindedir**. Uygulama sıra perspektifine kendisi çevirir.
- `line` boşlukla ayrılmış UCI hamleleridir. Lichess'in `e1h1` / `e8h8` gibi rok notasyonları standart UCI'ye (`e1g1`, `e8g8`) çevrilir.
- Aynı FEN'in birden fazla PV satırı tek pozisyonda birleştirilir; aynı ilk hamlenin en derin satırı tutulur.

### Veri setini yeniden üretmek

Kaynak: [`Lichess/chess-position-evaluations`](https://huggingface.co/datasets/Lichess/chess-position-evaluations). Şema gerçekten şudur:

```text
fen: VARCHAR, line: VARCHAR, depth: UTINYINT, knodes: INTEGER, cp: SMALLINT, mate: TINYINT
```

Script, 2 GB'lık parquet parçalarını tamamen indirmeden DuckDB `httpfs` ile okur:

```bash
pip install duckdb chess
python scripts/build_dataset.py --limit-per-phase 167 --out public/data/curated_positions.json
```

Mevcut 2000'lik dosya, ilk 38 küratörlü pozisyonun üzerine iki Lichess taramasından (350.000 ve 800.000 satır) seçilen 1962 pozisyon eklenerek oluşturuldu (667 açılış / 667 orta oyun / 666 oyun sonu).

Faydalı seçenekler:

```bash
# Daha geniş tarama, daha fazla aday
python scripts/build_dataset.py --scan-limit 750000 --shard-count 2

# İndirilmiş yerel parquet ile (ağ yoksa)
python scripts/build_dataset.py --local scripts/data/data_0000.parquet

# Filtreleri sıkılaştır
python scripts/build_dataset.py --min-depth 24 --max-gap 100 --eval-band 250
```

Notlar:

- Lichess FEN'leri dört alanlıdır (`... w KQkq -`); script altı alanlı FEN üretir.
- Evre sınıflandırması materyal ve vezir varlığına dayanır (`≤14 taş` veya vezirsiz `≤20 taş` → oyun sonu; `≥26 taş` ve iki vezir → açılış).
- Varsayılan `--shard-count 1`, ilk parçadan `350.000` PV satırı okur. Daha çeşitli havuz için `--shard-count` veya `--scan-limit` artırılabilir.
- Script kendi başına veri setini doğrular: her PV, FEN'den itibaren python-chess ile oynanır; yasadışı satırlar atılır.

Doğrulama:

```bash
npm run dataset:verify
```

## Proje yapısı

```text
src/
  app/
    page.tsx                 # antrenman sayfası
    stats/page.tsx           # istatistikler
    api/explain/route.ts     # OpenRouter/MiniMax + yerel koç
  components/
    TrainerShell.tsx         # akış, adaylar, analiz, kayıt
    TrainerBoard.tsx         # react-chessboard, oklar, tıklama/sürükleme
    CandidateSelector.tsx    # çift/tek aday yuvaları
    EvaluationReveal.tsx     # skor, Top-3 PV, koç
    VariationExplorer.tsx    # PV adım adım oynatma
    StatsDashboard.tsx       # localStorage istatistikleri
  lib/
    accuracy.ts              # Win%, Accuracy, CPL, sınıflandırma
    chess-utils.ts           # FEN, UCI→SAN, varyant kareleri
    stockfishWorker.ts       # Stockfish 19 Lite UCI köprüsü
    coach.ts                 # yerel Türkçe koç notu
    storage.ts               # localStorage
public/
  data/curated_positions.json
  engine/stockfish.js|.wasm
scripts/build_dataset.py
tests/accuracy.test.ts
tests/dataset.test.ts
```

## Testler

```bash
npm test          # vitest: formüller, sınıflandırma, veri seti bütünlüğü
npm run typecheck # tsc --noEmit
npm run build     # üretim derlemesi
```

Veri seti testi her FEN'i ve her PV'yi chess.js ile yeniden oynatır; ayrıca depth, mate, cp bandı ve PV sayısı filtrelerini doğrular.

## Bilinen sınırlar

- İstatistikler tarayıcıya özeldir; cihazlar arasında eşitlenmez.
- Stockfish WASM ilk açılışta birkaç saniye yüklenebilir. Yüklenemezse veri seti PV'leri yine çalışır; yalnızca veri seti dışı adaylar yaklaşık değerlendirilir.
- AI sağlayıcı anahtarı yoksa koç notu şablonludur; sayı üretmez, yalnızca verilen PV'leri açıklar.
- Veri seti Lichess değerlendirmelerine dayanır; motor sürümü ve derinlik kaynağa göre değişebilir.
- Stockfish GPLv3 lisanslıdır; `public/engine/` altındaki dağıtım bu lisansı korur.

## Lisans / kaynaklar

- Pozisyon değerlendirmeleri: [Lichess](https://lichess.org) açık verisi.
- Satranç kuralları ve PGN/PV işleme: [chess.js](https://github.com/jhlywa/chess.js).
- Tahta: [react-chessboard](https://github.com/Clariity/react-chessboard).
- Motor: [Stockfish](https://stockfishchess.org/) 19 Lite (WASM).
