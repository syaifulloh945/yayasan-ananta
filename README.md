# Website Yayasan Ananta Karuna Bahagia

Satu file `index.html` (HTML, CSS, JavaScript jadi satu) + folder `assets/img`. Tanpa proses build, bisa langsung di-upload ke hosting apa pun (GitHub Pages, Netlify, cPanel, dll.).

## WAJIB sebelum online: ganti rekening donasi
Buka `index.html`, cari `var CONFIG =` (di bagian `<script>` paling bawah):

```js
rekening: [
  { kode: "BSI", bank: "Bank Syariah Indonesia", nomor: "0000000000", atasNama: "Yayasan Ananta Karuna Bahagia", contoh: true },
  ...
],
qris: "",
```

- Ganti `nomor`, `bank`, `kode` (singkatan 3–4 huruf), dan `atasNama` dengan rekening resmi yayasan.
- Ubah `contoh: true` menjadi `contoh: false`. Selama masih `true`, formulir donasi menampilkan peringatan "Rekening contoh, jangan transfer dulu".
- Rekening bisa ditambah/dikurangi (satu baris `{ ... }` = satu bank).
- QRIS: simpan gambar QRIS ke `assets/img/qris.png`, lalu isi `qris: "assets/img/qris.png"`.
- `whatsapp`: nomor admin penerima konfirmasi (format `62...` tanpa `+`).
- `kodeUnik: false` jika tidak ingin memakai 3 digit kode unik.

## Alur donasi
Pilih program & nominal → isi nama (atau Hamba Allah) + doa → pilih bank/QRIS → tampil rincian transfer + tombol salin → "Konfirmasi via WhatsApp" membuka chat admin berisi rincian donasi.

## Data lain
Semua teks (program, struktur, kontak, angka capaian) bisa diedit langsung di `index.html`. Angka capaian ada di atribut `data-count="..."`.
