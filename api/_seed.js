// Campaign awal yang dimasukkan otomatis SATU KALI ke database.
// Setelah masuk, campaign bisa diubah/dihapus lewat panel admin dan tidak akan dimasukkan ulang
// (penanda tersimpan di tabel "meta").
export const SEED_CAMPAIGNS = [
  {
    slug: 'bantu-adik-rafka-melawan-hydrocephalus',
    title: 'Kepala Terus Membesar, Bantu Adik Rafka Berjuang Melawan Hydrocephalus',
    category: 'Kesehatan',
    summary: 'Sejak usia 1 bulan kepala Adik Rafka terus membesar karena hydrocephalus. Ayahnya buruh bangunan berupah Rp100 ribu/hari. Bantu biaya fisioterapi, susu khusus, dan kebutuhan harian Adik Rafka.',
    target: 25000000,
    collected: 0,
    donors: 0,
    deadline: null,
    sort: 0,
    visible: true,
    images: [
      '/assets/img/campaign/rafka-1.webp',
      '/assets/img/campaign/rafka-2.webp',
      '/assets/img/campaign/rafka-3.webp',
      '/assets/img/campaign/rafka-4.webp'
    ],
    story: `“Kalo seandainya Allah manggil aku duluan, gimana nasibnya adek Rafka, siapa yang mau ngurus.” Ibu Rafka berkata sambil menangis.

Rafka Rama Dika, bayi berusia kurang dari 1 tahun, harus menghadapi sakit yang menyerang bagian kepalanya sedari bayi. Awalnya, pada saat lahir sakitnya belum terlihat, masih seperti bayi pada umumnya. Setelah Rafka berusia 1 bulan, ibunya menyadari kepala Adik Rafka semakin membesar, tetapi masih mengira itu bagian dari perkembangan bayi. Namun lama-kelamaan semakin terlihat jika kepalanya lebih besar dari badan Adik Rafka, dan pandangannya cenderung ke bawah.

Pada usia 4 bulan, Adik Rafka dibawa ke dokter untuk dilakukan pemeriksaan. Di hari itu juga keluar hasilnya: ternyata Adik Rafka mengidap penyakit Hydrocephalus. HANCUR hati kedua orang tua Rafka saat tahu penyakit yang diderita anaknya SEMENAKUTKAN itu. Dokter pun langsung membuat surat rujukan ke rumah sakit yang ada di Metro, kemudian dirujuk ke rumah sakit di Bandar Lampung untuk tindakan operasi pemasangan selang.

"Awal tau adek harus dioperasi, jujur waktu itu ekonomi lagi terbatas, baru selesai lebaran, jadi bapaknya belum ada kerjaan, sama sekali gak megang uang, megang pun cuma 60rb. Waktu dirujuk ke RS Bandar Lampung bingung uangnya dari mana," ucap pilu Ibu Rafka.

Sebelum operasi pemasangan selang, lingkar kepala Adik Rafka mencapai 46 cm. Kabar baiknya, setelah dioperasi mengecil menjadi 43 cm. Efek yang ditimbulkan setelah operasi adalah tumbuh kembang Adik Rafka menjadi terhambat, tidak seperti anak normal pada umumnya. Adik Rafka merespons jika dipanggil, tetapi matanya sangat sulit untuk fokus karena efek pemasangan selang dari kepala sampai saluran kemih. “Kadang sedih waktu sedang mengASIhi, pengennya ditatap sama adek, maunya dia bisa lihat ibunya,” ucap Ibu Rafka.

Sementara itu, Ayah Rafka hanya seorang kuli bangunan dengan upah Rp100 ribu per hari. Dengan pendapatan seminim itu, tidak mungkin cukup jika harus dibagi untuk keperluan sehari-hari dan biaya pengobatan Adik Rafka. Titik terendahnya adalah saat harus mengorbankan biaya sekolah kakak-kakaknya karena harus mendahulukan biaya pengobatan Rafka.

Saking susahnya keadaan ekonomi mereka, demi biaya pengobatan Adik Rafka, keluarga sering mencari pinjaman uang ke kerabat hingga Rp4 juta banyaknya dan bingung bagaimana membayarnya. Bahkan mereka harus rela menjual motor demi Adik Rafka bisa dioperasi.

Harapan orang tua Adik Rafka: semoga Adik Rafka bisa terus kuat, segera diangkat penyakitnya, dipanjangkan umurnya, dan bisa bertumbuh normal seperti anak-anak seusianya. Sangat terpuruk rasanya bila harus melihat Adik Rafka terus sakit seperti ini.

Rencana penggunaan dana: membiayai operasional fisioterapi yang dilakukan dua kali dalam seminggu di rumah sakit di Metro, serta mencukupi kebutuhan pokok Adik Rafka. Kebutuhan tersebut meliputi popok, susu khusus yang harus dikonsumsi Adik Rafka, bahan makanan untuk MPASI, vitamin yang tidak ditanggung BPJS, serta obat-obatan. Meskipun obat-obatan sudah ditanggung BPJS, apabila persediaannya habis sebelum mendapatkan resep berikutnya, keluarga terpaksa harus membelinya sendiri.

Pesan dari Ibu Rafka untuk orang-orang di luar sana yang berada di posisi yang sama: "Semangat, kita saling menguatkan, harus tabah, namanya anak harus kita perjuangkan."

Halo Sahabat Ananta, mari kita rangkul Adik Rafka dan kedua orang tuanya agar terus kuat berjuang demi kesembuhan Adik Rafka. Kasihan jika badan kecil itu harus terus-menerus merasakan sakit. Klik tombol "Donasi Sekarang" dan bagikan kisah ini ke orang-orang terdekat Anda agar semakin banyak tangan yang tergerak membantu Adik Rafka.`
  }
];
