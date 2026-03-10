saya membuat system IoT monitoring yang memiliki konsep plug and play and customizable. terdari dari

- main module : 1 raspi, 1 gps, dan 1 esp receiver. berfungsi untuk mengumpulkan data dari sensor controller dan mengirimkan data tersebut ke server
- sensor controller: terdiri dari 1 esp dan 1 hingga 8 sensor node . berfungsi sebagai pengumpul data dari sensor node dan mengirimkan data tersebut ke main module.
- sensor node: terdiri dari 1 seeeduino xiao dan 1 sensor. berfungsi untuk melakukan monitoring lalu mengirimkan data ke sensor controller. sensor yang digunakan bisa bervariasi tergantung kebutuhan

key point:

- Sensor pada port bisa berubah2 sesekali, tergantung kebutuhan pengguna

Folder ini berisikan semua source code yang saya gunakan