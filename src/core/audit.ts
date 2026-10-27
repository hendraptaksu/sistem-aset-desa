// Helper audit murni — tanpa dependency DB/Electron.
// Dipakai semua modul yang menulis `audit_log` agar bentuk data konsisten.

import type { AuditLog } from './types.js';

/**
 * Serialisasi data audit yang aman: string/objek/null tidak boleh membuat
 * penulisan audit gagal. String yang sudah berupa JSON dipertahankan agar
 * pemanggil lama tetap kompatibel; selain itu di-stringify.
 */
export function jsonAuditAman(data: unknown): string {
  if (data === undefined) return '';
  if (typeof data === 'string') {
    const teks = data.trim();
    if (!teks) return '';
    try {
      JSON.parse(teks);
      return teks;
    } catch {
      return JSON.stringify(data);
    }
  }
  try {
    return JSON.stringify(data) ?? '';
  } catch {
    // Objek sirkular / BigInt / nilai tak bisa diserialisasi: tetap simpan
    // representasi teks supaya audit tidak hilang dan tidak melempar error.
    try {
      return JSON.stringify(String(data));
    } catch {
      return '';
    }
  }
}

export type OpsiAuditLog = {
  /** ID & tanggal eksplisit untuk test/determinisme; default otomatis. */
  id?: string;
  tanggal?: string;
};

/**
 * Buat baris audit (belum ditulis ke DB). `dataBaru` opsional agar pemanggil
 * lama (aksi, alasan, dataLama) tetap bekerja; pemanggil baru mengisi keduanya.
 */
export function buatAuditLog(
  aksi: string,
  alasan: string,
  dataLama?: unknown,
  dataBaru?: unknown,
  opsi: OpsiAuditLog = {},
): AuditLog {
  return {
    id: opsi.id ?? `audit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    tanggal: opsi.tanggal ?? new Date().toISOString(),
    aksi,
    alasan,
    data_lama_json: jsonAuditAman(dataLama),
    data_baru_json: jsonAuditAman(dataBaru),
  };
}
