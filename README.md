# CandidateMaster

Aday hamle (candidate move) antrenörü. Taktik bulmacalar yerine gerçek oyunlardan gelen dengeli pozisyonlarda **iki güçlü fikri** seçmeyi, ardından seçimi centipawn kaybı ve Lichess doğruluk eğrisiyle ölçmeyi amaçlar.

Türkçe arayüz, koyu ve odaklı bir “minimalist Lichess / neo-brutalist” görünüm.

## Neler var?

- **Çift aday / tek hamle modu** — iki aday aynı pozisyondan seçilir; birincil tercih PV1, alternatif PV2 ile kıyaslanır.
- **3500 doğal pozisyon** — 1167 açılış, 1167 orta oyun, 1166 oyun sonu; bu ilk sette ilk 38 küratörlü pozisyon korunur. Hedef 5000.
- **Aylık yenilenen set** — her ay farklı bir Lichess parquet shard'ından yeni 3500 pozisyon üretilir; böylece pozisyonlar ezberlenmez.
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

Çalışma zamanındaki veri tek bir dosya değil, evre bazlı üç dosya ve bir manifesttir:

```text
public/data/
  manifest.json
  opening.json
  middlegame.json
  endgame.json
```

`manifest.json` sayımları, setin ayını ve dosya adlarını taşır:

```json
{
  "version": 1,
  "generatedAt": "2026-10-22T...",
  "month": "2026-10",
  "source": "Lichess cloud evaluation + Lichess/chess-position-evaluations",
  "positionCount": 3500,
  "phaseCounts": { "opening": 1167, "middlegame": 1167, "endgame": 1166 },
  "files": {
    "opening": "opening.json",
    "middlegame": "middlegame.json",
    "endgame": "endgame.json"
  },
  "refresh": {
    "month": "2026-10",
    "shardStart": 2,
    "scanLimit": 1000000,
    "seed": 20264500,
    "total": 3500
  }
}
```

Her evre dosyası yalnızca kendi evresindeki pozisyonları içerir:

```json
{
  "version": 1,
  "generatedAt": "2026-10-22T...",
  "phase": "middlegame",
  "positionCount": 1167,
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
- `manifest.json` ile evre dosyalarının toplamı eşleşmezse uygulama veri setini yüklemeyi reddeder.

### Veri setini yeniden üretmek

Kaynak: [`Lichess/chess-position-evaluations`](https://huggingface.co/datasets/Lichess/chess-position-evaluations). Şema gerçekten şudur:

```text
fen: VARCHAR, line: VARCHAR, depth: UTINYINT, knodes: INTEGER, cp: SMALLINT, mate: TINYINT
```

Script, 2 GB'lık parquet parçalarını tamamen indirmeden DuckDB `httpfs` ile okur. Aylık seti yenilemek için:

```bash
pip install duckdb chess
npm run dataset
```

Bu komut, içinde bulunulan aya göre dönen bir Lichess shard'ından **3500** pozisyon üretir ve `public/data/` altındaki manifest + üç evre dosyasını yeniden yazar. Belirli bir ayı veya hedef sayıyı elle seçmek için:

```bash
python scripts/refresh_dataset.py --month 2026-11 --total 3500
python scripts/refresh_dataset.py --month 2026-11 --total 5000   # nihai hedef
python scripts/refresh_dataset.py --dry-run --total 30 --scan-limit 200000
```

Aylık rotasyon:

- 20 Lichess parquet shard'ı vardır. Script ay indeksine göre bir shard seçer; ilk setin kullandığı shard'lardan başlamamak için `+1` offset uygular.
- `--seed` ay ve hedef sayıdan türetilir; aynı ay tekrar üretilirse aynı set çıkar, farklı ay yeni set üretir.
- GitHub Actions `.github/workflows/monthly-dataset.yml` her ayın 1'inde çalışır, testleri geçerse yeni seti `main`e commit eder. Vercel bu commit'i otomatik yayınlar.
- İlk 3500'lük set, mevcut 2500 pozisyonun üzerine shard-1 havuzundan 333 açılış / 334 orta oyun / 333 oyun sonu eklenerek oluşturuldu.

Tek seferlik örnek veya hata ayıklama üretimi:

```bash
# Küçük bir örnek seti doğrudan evre dosyalarına yaz
python scripts/build_dataset.py --limit-per-phase 20 --split-dir /tmp/candidate-data

# Tek dosyalık çıktı
python scripts/build_dataset.py --limit-per-phase 20 --out /tmp/sample.json

# Daha geniş tarama, daha fazla aday
python scripts/build_dataset.py --scan-limit 750000 --shard-count 2 --split-dir /tmp/candidate-data

# İndirilmiş yerel parquet ile (ağ yoksa)
python scripts/build_dataset.py --local scripts/data/data_0000.parquet --split-dir /tmp/candidate-data
```

Eski tek dosyalık veri setini evrelere bölmek için:

```bash
python scripts/split_dataset.py --input public/data/curated_positions.json
```

Notlar:

- Lichess FEN'leri dört alanlıdır (`... w KQkq -`); script altı alanlı FEN üretir.
- Evre sınıflandırması materyal ve vezir varlığına dayanır (`≤14 taş` veya vezirsiz `≤20 taş` → oyun sonu; `≥26 taş` ve iki vezir → açılış).
- Script kendi başına veri setini doğrular: her PV, FEN'den itibaren python-chess ile oynanır; yasadışı satırlar atılır.
- `npm run dataset:verify` manifesti, evre dosyalarını, sayımları, filtreleri ve tüm PV'leri yeniden doğrular.

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
    positions.ts             # manifest + evre dosyalarını yükleme
    stockfishWorker.ts       # Stockfish 19 Lite UCI köprüsü
    coach.ts                 # yerel Türkçe koç notu
    storage.ts               # localStorage
public/
  data/
    manifest.json            # ay, sayımlar, dosya adları
    opening.json             # 1167 açılış
    middlegame.json          # 1167 orta oyun
    endgame.json             # 1166 oyun sonu
  engine/stockfish.js|.wasm
scripts/
  build_dataset.py           # tek seferlik üretim / örnek
  refresh_dataset.py         # aylık dönen shard + yeni set
  split_dataset.py           # monoliti evrelere bölme
  dataset_io.py              # ortak yazma/doğrulama
.github/workflows/
  monthly-dataset.yml        # aylık otomatik yenileme + test + commit
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
- Aylık yenileme GitHub Actions'a bağlıdır; workflow devre dışı kalırsa `npm run dataset` ile elle çalıştırılabilir.
- Veri seti Lichess değerlendirmelerine dayanır; motor sürümü ve derinlik kaynağa göre değişebilir.
- Stockfish GPLv3 lisanslıdır; `public/engine/` altındaki dağıtım bu lisansı korur.

## Lisans / kaynaklar

- Pozisyon değerlendirmeleri: [Lichess](https://lichess.org) açık verisi.
- Satranç kuralları ve PGN/PV işleme: [chess.js](https://github.com/jhlywa/chess.js).
- Tahta: [react-chessboard](https://github.com/Clariity/react-chessboard).
- Motor: [Stockfish](https://stockfishchess.org/) 19 Lite (WASM).
