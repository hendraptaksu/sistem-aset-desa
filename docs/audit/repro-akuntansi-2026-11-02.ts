// Observasi audit 2 November 2026. Menjalankan skenario pada SQLite :memory: saja.
// Jalankan dari root repo: node --import tsx docs/audit/repro-akuntansi-2026-11-02.ts
// Ini mencatat perilaku saat audit, bukan menyatakan perilaku bermasalah sebagai kontrak yang benar.
// Angka output menggunakan Rupiah, kecuali FRACTIONAL_SEN_SQL yang memperlihatkan nilai mentah sen.
import { openDb } from '../../src/db/database.ts';
import { postingJurnal } from '../../src/db/posting.ts';
import { laporanArusKas, laporanNeraca, laporanLabaRugi, listBarisJurnal } from '../../src/db/laporan.ts';
import { simpanPinjamanLpd, bayarAngsuranPinjaman, getPinjaman } from '../../src/db/pinjaman.ts';
import { reverseJurnal } from '../../src/db/reversal.ts';
import { auditIntegritas } from '../../src/db/integritas.ts';
import { statusSaldoAwal, simpanSaldoAwal } from '../../src/db/saldoAwal.ts';
import { serahkanPanjar, closePanjarV2 } from '../../src/db/panjar.ts';
import { buatJurnalSaldoAwal } from '../../src/core/forms.ts';
import { saldoAkun } from '../../src/core/reports.ts';
const rp = (x:number) => x*100;
const D = (akun_kode:string,x:number) => ({akun_kode,debit:rp(x),kredit:0});
const K = (akun_kode:string,x:number) => ({akun_kode,debit:0,kredit:rp(x)});
function requireSaved(r:any) { if(!r.tersimpan) throw new Error(JSON.stringify(r)); return r; }
function awal() { const db=openDb(':memory:'); requireSaved(simpanSaldoAwal(db,buatJurnalSaldoAwal({tanggal:'2025-01-01',id:'awal',saldo:[{akun_kode:'1001',nominal:rp(20_000_000)}]}).input)); return db; }
{
 const db=awal();
 const r=laporanArusKas(db,{mulai:'2025-01-01',sampai:'2025-12-31'});
 console.log('OPENING_AS_FLOW',JSON.stringify({saldoAwal:r.saldoAwal/100,pendanaanMasuk:r.pendanaan.masuk/100,kenaikan:r.kenaikan/100,saldoAkhir:r.saldoAkhir/100}));
 db.close();
}
{
 const db=awal();
 const loan=requireSaved(simpanPinjamanLpd(db,{id:'loan',mode:'PENCAIRAN',kreditur:'LPD Uji',tanggal:'2025-02-01',akunKas:'1001',pokok:rp(10_000_000),tenor:1,angsuran:[{ke:1,jatuh_tempo:'2025-03-01',pokok:rp(10_000_000),bunga:rp(100_000)}]}));
 const pay=requireSaved(bayarAngsuranPinjaman(db,{id:'pay',jurnal_id:'pay-journal',pinjaman_id:'loan',angsuran_id:loan.pinjaman.angsuran[0].id,tanggal:'2025-03-01',akun_kas:'1001',pokok:rp(10_000_000),bunga:rp(100_000),denda:0}));
 const r=laporanArusKas(db,{mulai:'2025-03-01',sampai:'2025-03-31'});
 console.log('LOAN_CASHFLOW',JSON.stringify({operasiKeluar:r.operasi.keluar/100,pendanaanKeluar:r.pendanaan.keluar/100,totalKeluar:r.totalKeluar/100}));
 requireSaved(reverseJurnal(db,'pay-journal','Salah input pembayaran'));
 const p=getPinjaman(db,'loan')!;
 const a=auditIntegritas(db);
 console.log('REVERSE_LOAN_PAYMENT',JSON.stringify({glUtang:saldoAkun(listBarisJurnal(db),'2050')/100,outstanding:p.outstanding!/100,status:p.angsuran![0].status,auditOk:a.ok,temuan:a.temuan.map(t=>t.kode)}));
 db.close();
}
{
 const db=awal();
 const loan=requireSaved(simpanPinjamanLpd(db,{id:'loan',mode:'PENCAIRAN',kreditur:'LPD Uji',tanggal:'2025-02-01',akunKas:'1001',pokok:rp(10_000_000),tenor:1,angsuran:[{ke:1,jatuh_tempo:'2025-03-01',pokok:rp(10_000_000),bunga:rp(100_000)}]}));
 requireSaved(reverseJurnal(db,loan.jurnal.id,'Batal pencairan pinjaman'));
 const p=getPinjaman(db,'loan')!; const a=auditIntegritas(db);
 console.log('REVERSE_LOAN_DISBURSEMENT',JSON.stringify({glUtang:saldoAkun(listBarisJurnal(db),'2050')/100,outstanding:p.outstanding!/100,auditOk:a.ok,temuan:a.temuan.map(t=>t.kode)})); db.close();
}
{
 const db=awal();
 requireSaved(serahkanPanjar(db,{id:'panjar',tanggal:'2025-12-20',penerima:'Pengurus Uji',jumlah:rp(1_000_000),akunKasSumber:'1001'}));
 requireSaved(closePanjarV2(db,{id:'panjar',tanggalClose:'2026-01-05',items:[{akun:'5003',nominal:rp(900_000),nota_tanggal:'2025-12-28',toko:'Toko Uji'}]}));
 const lr=laporanLabaRugi(db,{mulai:'2025-01-01',sampai:'2025-12-31'}); const n=laporanNeraca(db,'2025-12-31'); const lr26=laporanLabaRugi(db,{mulai:'2026-01-01',sampai:'2026-12-31'});
 console.log('PANJAR_CROSS_YEAR',JSON.stringify({beban2025:lr.totalBeban/100,beban2026:lr26.totalBeban/100,panjar2025:n.aset.find(a=>a.kode==='1040')!.saldo/100})); db.close();
}
{
 const db=openDb(':memory:');
 requireSaved(postingJurnal(db,{header:{id:'tx',tanggal:'2025-01-02',keterangan:'Penerimaan awal',jenis:'TERIMA'},baris:[D('1001',100),K('4001',100)]}));
 const status=statusSaldoAwal(db); const save=simpanSaldoAwal(db,buatJurnalSaldoAwal({tanggal:'2025-01-01',saldo:[{akun_kode:'1001',nominal:rp(1000)}]}).input);
 console.log('OPENING_STATUS',JSON.stringify({status,tersimpan:save.tersimpan,errors:save.errors}));db.close();
}
{
 const db=awal();
 const loan=requireSaved(simpanPinjamanLpd(db,{id:'loan',mode:'PENCAIRAN',kreditur:'LPD Uji',tanggal:'2025-02-01',akunKas:'1001',pokok:rp(10_000_000),tenor:1,angsuran:[{ke:1,jatuh_tempo:'2025-03-01',pokok:rp(10_000_000),bunga:rp(100_000)}]}));
 const aid=loan.pinjaman.angsuran[0].id;
 requireSaved(bayarAngsuranPinjaman(db,{id:'partial',jurnal_id:'partial-j',pinjaman_id:'loan',angsuran_id:aid,tanggal:'2025-03-01',akun_kas:'1001',pokok:0,bunga:rp(100_000),denda:0},{konfirmasiSelisih:true,alasanSelisih:'Hanya membayar bunga dahulu'}));
 const p=getPinjaman(db,'loan')!;
 const attempt=bayarAngsuranPinjaman(db,{id:'rest',jurnal_id:'rest-j',pinjaman_id:'loan',angsuran_id:aid,tanggal:'2025-03-02',akun_kas:'1001',pokok:rp(10_000_000),bunga:0,denda:0},{konfirmasiSelisih:true,alasanSelisih:'Membayar sisa pokok kemarin'});
 console.log('PARTIAL_LOAN',JSON.stringify({outstanding:p.outstanding!/100,status:p.angsuran![0].status,nextPaymentSaved:attempt.tersimpan,nextErrors:attempt.errors}));db.close();
}
{
 const db=awal();
 requireSaved(serahkanPanjar(db,{id:'panjar',tanggal:'2025-12-20',penerima:'Pengurus Uji',jumlah:rp(1_000_000),akunKasSumber:'1001'}));
 const close=requireSaved(closePanjarV2(db,{id:'panjar',tanggalClose:'2025-12-28',items:[{akun:'5003',nominal:rp(900_000),nota_tanggal:'2025-12-28',toko:'Toko Uji'}]}));
 const rev=reverseJurnal(db,close.jurnal.id,'Salah kategori realisasi');
 const recl=closePanjarV2(db,{id:'panjar',tanggalClose:'2025-12-28',items:[{akun:'5010',nominal:rp(800_000)}]});
 console.log('CLOSED_PANJAR_CORRECTION',JSON.stringify({reverseSaved:rev.tersimpan,reverseErrors:rev.errors,recloseSaved:recl.tersimpan,recloseErrors:recl.errors}));db.close();
}
{
 const db=openDb(':memory:');
 db.prepare("INSERT INTO jurnal(id,tanggal,no_bukti,keterangan,jenis,grup_id,created_at) VALUES ('fraction','2025-01-01','FRACTION','Nilai pecahan sen SQL','UMUM','fraction','2025-01-01T00:00:00.000Z')").run();
 db.prepare("INSERT INTO jurnal_baris(jurnal_id,akun_kode,debit,kredit) VALUES ('fraction','1001',0.5,0),('fraction','4001',0,0.5)").run();
 const a=auditIntegritas(db);
 console.log('FRACTIONAL_SEN_SQL',JSON.stringify({rows:db.prepare("SELECT akun_kode,debit,kredit,typeof(debit) AS tipe_debit,typeof(kredit) AS tipe_kredit FROM jurnal_baris").all(),auditOk:a.ok,temuan:a.temuan.map(t=>t.kode)}));db.close();
}
