export type PackageShape =
  | { kind: 'chip' }
  | { kind: 'dual'; pins: number }
  | { kind: 'quad'; pinsPerSide: number }
  | { kind: 'sot'; top: number; bottom: number }
  | { kind: 'through-dual'; pins: number }
  | { kind: 'to' }
  | { kind: 'radial' }
  | { kind: 'axial' }
  | { kind: 'header'; rows: number; columns: number }
  | { kind: 'usb' }
  | { kind: 'generic' };

export type PackageInfo = {
  shape: PackageShape;
  // Nominal body size as published in the common industry outlines.
  body?: string;
  mounting: 'Surface mount' | 'Through hole';
};

const PACKAGES: Record<string, PackageInfo> = {
  '0402': { shape: { kind: 'chip' }, body: '1.0 x 0.5 mm', mounting: 'Surface mount' },
  '0603': { shape: { kind: 'chip' }, body: '1.6 x 0.8 mm', mounting: 'Surface mount' },
  '0805': { shape: { kind: 'chip' }, body: '2.0 x 1.25 mm', mounting: 'Surface mount' },
  '1206': { shape: { kind: 'chip' }, body: '3.2 x 1.6 mm', mounting: 'Surface mount' },
  'SOD-123': { shape: { kind: 'chip' }, body: '2.7 x 1.6 mm', mounting: 'Surface mount' },
  SMA: { shape: { kind: 'chip' }, body: '4.3 x 2.6 mm', mounting: 'Surface mount' },
  'SOT-23': {
    shape: { kind: 'sot', top: 1, bottom: 2 },
    body: '2.9 x 1.3 mm',
    mounting: 'Surface mount',
  },
  'SOT-23-5': {
    shape: { kind: 'sot', top: 2, bottom: 3 },
    body: '2.9 x 1.6 mm',
    mounting: 'Surface mount',
  },
  'SOT-223': {
    shape: { kind: 'sot', top: 1, bottom: 3 },
    body: '6.5 x 3.5 mm',
    mounting: 'Surface mount',
  },
  'SOIC-8': { shape: { kind: 'dual', pins: 8 }, body: '4.9 x 3.9 mm', mounting: 'Surface mount' },
  'TSSOP-20': {
    shape: { kind: 'dual', pins: 20 },
    body: '6.5 x 4.4 mm',
    mounting: 'Surface mount',
  },
  'QFN-24': {
    shape: { kind: 'quad', pinsPerSide: 6 },
    body: '4.0 x 4.0 mm',
    mounting: 'Surface mount',
  },
  'QFN-32': {
    shape: { kind: 'quad', pinsPerSide: 8 },
    body: '5.0 x 5.0 mm',
    mounting: 'Surface mount',
  },
  'LQFP-48': {
    shape: { kind: 'quad', pinsPerSide: 12 },
    body: '7.0 x 7.0 mm',
    mounting: 'Surface mount',
  },
  'LQFP-64': {
    shape: { kind: 'quad', pinsPerSide: 16 },
    body: '10.0 x 10.0 mm',
    mounting: 'Surface mount',
  },
  'DIP-8': {
    shape: { kind: 'through-dual', pins: 8 },
    body: '9.3 x 6.4 mm',
    mounting: 'Through hole',
  },
  'TO-92': { shape: { kind: 'to' }, body: '4.6 x 3.6 mm', mounting: 'Through hole' },
  'TO-220': { shape: { kind: 'to' }, body: '10.2 x 4.6 mm', mounting: 'Through hole' },
  'Radial 5 mm': { shape: { kind: 'radial' }, body: 'Diameter 5.0 mm', mounting: 'Through hole' },
  'Radial 8 mm': { shape: { kind: 'radial' }, body: 'Diameter 8.0 mm', mounting: 'Through hole' },
  Axial: { shape: { kind: 'axial' }, mounting: 'Through hole' },
  'USB-C': { shape: { kind: 'usb' }, mounting: 'Surface mount' },
};

export function packageInfo(name: string): PackageInfo {
  const known = PACKAGES[name];
  if (known) return known;
  const header = /^Header (\d+)x(\d+)$/.exec(name);
  if (header) {
    return {
      shape: { kind: 'header', rows: Number(header[1]), columns: Number(header[2]) },
      mounting: 'Through hole',
    };
  }
  return { shape: { kind: 'generic' }, mounting: 'Surface mount' };
}
