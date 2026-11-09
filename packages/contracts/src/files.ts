/** Limites de anexos decididos para o produto. */
export const FILE_RULES = {
  maxSizeBytes: 50 * 1024 * 1024,
  /** Extensões bloqueadas: executáveis e scripts. */
  blockedExtensions: [
    'exe',
    'msi',
    'msp',
    'bat',
    'cmd',
    'com',
    'scr',
    'pif',
    'cpl',
    'dll',
    'sys',
    'ps1',
    'psm1',
    'vbs',
    'vbe',
    'js',
    'jse',
    'wsf',
    'wsh',
    'hta',
    'lnk',
    'reg',
    'jar',
    'sh',
    'bash',
    'apk',
    'app',
    'dmg',
    'deb',
    'rpm',
    'iso',
    'img',
    'vhd',
  ],
} as const;

export interface UploadedFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  width: number | null;
  height: number | null;
}

export const fileUrl = (id: string) => `/api/v1/files/${id}`;
export const thumbnailUrl = (id: string) => `/api/v1/files/${id}/thumbnail`;

/** Foto de perfil: recortada em quadrado e convertida para WebP no servidor. */
export const AVATAR_RULES = {
  maxSizeBytes: 5 * 1024 * 1024,
  sizePx: 256,
  acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
} as const;
