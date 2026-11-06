// Every maker, part number and specification below is invented for this project.
// Real part numbers and real company names are avoided on purpose. Only generic
// things stay real: package outlines such as 0603 or SOT-23, and units.

export type SeedManufacturer = { slug: string; name: string; prefix: string };

export type SeedCategory = {
  slug: string;
  name: string;
  description: string;
  filterSpecs: string[];
};

export type SeedProduct = {
  category: string;
  manufacturer: string;
  mpn: string;
  name: string;
  description: string;
  package: string;
  specs: [string, string][];
  basePriceCents: number;
};

export const MANUFACTURERS: SeedManufacturer[] = [
  { slug: 'orrin-passives', name: 'Orrin Passives', prefix: 'ORP' },
  { slug: 'marrowgate-components', name: 'Marrowgate Components', prefix: 'MGC' },
  { slug: 'quillon-semiconductor', name: 'Quillon Semiconductor', prefix: 'QLN' },
  { slug: 'tarnwick-microsystems', name: 'Tarnwick Microsystems', prefix: 'TW' },
  { slug: 'ostrel-power', name: 'Ostrel Power Devices', prefix: 'OPD' },
  { slug: 'fennick-interconnect', name: 'Fennick Interconnect', prefix: 'FNK' },
  { slug: 'lumenfold-opto', name: 'Lumenfold Opto', prefix: 'LMF' },
  { slug: 'kestrelby-sensing', name: 'Kestrelby Sensing', prefix: 'KSB' },
];

export const CATEGORIES: SeedCategory[] = [
  {
    slug: 'resistors',
    name: 'Resistors',
    description: 'Thick film chip resistors from 10 Ohm to 1 MOhm.',
    filterSpecs: ['Resistance', 'Tolerance', 'Power'],
  },
  {
    slug: 'capacitors',
    name: 'Capacitors',
    description: 'Ceramic chip capacitors and radial electrolytics.',
    filterSpecs: ['Capacitance', 'Voltage', 'Dielectric'],
  },
  {
    slug: 'inductors',
    name: 'Inductors',
    description: 'Chip power inductors for filters and converters.',
    filterSpecs: ['Inductance', 'Current rating'],
  },
  {
    slug: 'diodes',
    name: 'Diodes',
    description: 'Signal, Schottky, Zener, TVS and rectifier diodes.',
    filterSpecs: ['Type', 'Reverse voltage'],
  },
  {
    slug: 'leds',
    name: 'LEDs',
    description: 'Indicator LEDs in chip and through-hole packages.',
    filterSpecs: ['Colour', 'Forward voltage'],
  },
  {
    slug: 'transistors',
    name: 'Transistors',
    description: 'Small signal bipolar transistors and MOSFETs.',
    filterSpecs: ['Type', 'Max voltage'],
  },
  {
    slug: 'regulators',
    name: 'Voltage regulators',
    description: 'Fixed LDOs and step-down converters.',
    filterSpecs: ['Output voltage', 'Output current'],
  },
  {
    slug: 'microcontrollers',
    name: 'Microcontrollers',
    description: 'RV32 microcontrollers with on-chip flash.',
    filterSpecs: ['Flash', 'Clock'],
  },
  {
    slug: 'sensors',
    name: 'Sensors',
    description: 'Temperature, pressure, motion and light sensors.',
    filterSpecs: ['Measures', 'Interface'],
  },
  {
    slug: 'connectors',
    name: 'Connectors',
    description: 'Pin headers and USB-C receptacles.',
    filterSpecs: ['Type', 'Positions'],
  },
];

function resistors(): SeedProduct[] {
  const values: [string, string, number][] = [
    ['10 Ohm', '10R0', 0],
    ['47 Ohm', '47R0', 0],
    ['100 Ohm', '100R', 0],
    ['220 Ohm', '220R', 0],
    ['330 Ohm', '330R', 0],
    ['470 Ohm', '470R', 0],
    ['1 kOhm', '1K00', 0],
    ['2.2 kOhm', '2K20', 0],
    ['4.7 kOhm', '4K70', 0],
    ['10 kOhm', '10K0', 0],
    ['22 kOhm', '22K0', 0],
    ['47 kOhm', '47K0', 0],
    ['100 kOhm', '100K', 0],
    ['1 MOhm', '1M00', 0],
  ];
  const packages: [string, string, number][] = [
    ['0402', '0.063 W', 4],
    ['0603', '0.1 W', 5],
    ['0805', '0.125 W', 6],
    ['1206', '0.25 W', 9],
  ];
  const parts: SeedProduct[] = [];
  values.forEach(([value, code], valueIndex) => {
    packages.forEach(([pkg, power, price], packageIndex) => {
      const precise = (valueIndex + packageIndex) % 3 !== 0;
      const tolerance = precise ? '1%' : '5%';
      const maker = (valueIndex + packageIndex) % 2 === 0 ? 'ORP' : 'MGC';
      parts.push({
        category: 'resistors',
        manufacturer: maker,
        mpn: `${maker}-RC${pkg}-${code}-${precise ? 'F' : 'J'}`,
        name: `Thick film resistor ${value} ${tolerance} ${pkg}`,
        description: `General purpose thick film chip resistor, ${value} at ${tolerance}. Suits pull-ups, dividers and current limiting on small signal boards.`,
        package: pkg,
        specs: [
          ['Resistance', value],
          ['Tolerance', tolerance],
          ['Power', power],
          ['Temperature coefficient', precise ? '100 ppm/C' : '200 ppm/C'],
          ['Operating temperature', '-55 to 155 C'],
        ],
        basePriceCents: price + (precise ? 2 : 0),
      });
    });
  });
  return parts;
}

function capacitors(): SeedProduct[] {
  const ceramic: [string, string, string, number][] = [
    ['10 pF', '100', 'C0G', 7],
    ['22 pF', '220', 'C0G', 7],
    ['100 pF', '101', 'C0G', 8],
    ['1 nF', '102', 'X7R', 6],
    ['10 nF', '103', 'X7R', 6],
    ['100 nF', '104', 'X7R', 7],
    ['1 uF', '105', 'X7R', 11],
    ['4.7 uF', '475', 'X5R', 19],
    ['10 uF', '106', 'X5R', 26],
  ];
  const sizes: [string, string, number][] = [
    ['0402', '16 V', 0],
    ['0603', '25 V', 3],
    ['0805', '50 V', 8],
  ];
  const parts: SeedProduct[] = [];
  ceramic.forEach(([value, code, dielectric, price], valueIndex) => {
    sizes.forEach(([pkg, voltage, surcharge], sizeIndex) => {
      const maker = (valueIndex + sizeIndex) % 2 === 0 ? 'MGC' : 'ORP';
      parts.push({
        category: 'capacitors',
        manufacturer: maker,
        mpn: `${maker}-CC${pkg}-${code}-${voltage.replace(' V', 'V')}`,
        name: `Ceramic capacitor ${value} ${voltage} ${dielectric} ${pkg}`,
        description: `Multilayer ceramic chip capacitor with ${dielectric} dielectric. ${dielectric === 'C0G' ? 'Stable over temperature, for timing and RF work.' : 'A good default for decoupling close to a power pin.'}`,
        package: pkg,
        specs: [
          ['Capacitance', value],
          ['Voltage', voltage],
          ['Dielectric', dielectric],
          ['Tolerance', dielectric === 'C0G' ? '5%' : '10%'],
          ['Operating temperature', '-55 to 125 C'],
        ],
        basePriceCents: price + surcharge,
      });
    });
  });

  const electrolytic: [string, string, string, string, number][] = [
    ['10 uF', '50 V', 'Radial 5 mm', '10U50', 12],
    ['47 uF', '25 V', 'Radial 5 mm', '47U25', 14],
    ['100 uF', '16 V', 'Radial 5 mm', '101U16', 15],
    ['100 uF', '35 V', 'Radial 8 mm', '101U35', 21],
    ['220 uF', '25 V', 'Radial 8 mm', '221U25', 24],
    ['470 uF', '16 V', 'Radial 8 mm', '471U16', 27],
    ['470 uF', '35 V', 'Radial 8 mm', '471U35', 38],
    ['1000 uF', '16 V', 'Radial 8 mm', '102U16', 44],
  ];
  for (const [value, voltage, pkg, code, price] of electrolytic) {
    parts.push({
      category: 'capacitors',
      manufacturer: 'ORP',
      mpn: `ORP-EL-${code}`,
      name: `Aluminium electrolytic ${value} ${voltage} radial`,
      description:
        'Radial aluminium electrolytic capacitor for bulk storage on power rails. Rated for 2000 hours at 105 C.',
      package: pkg,
      specs: [
        ['Capacitance', value],
        ['Voltage', voltage],
        ['Dielectric', 'Aluminium'],
        ['Tolerance', '20%'],
        ['Operating temperature', '-40 to 105 C'],
      ],
      basePriceCents: price,
    });
  }
  return parts;
}

function inductors(): SeedProduct[] {
  const rows: [string, string, string, string, string, number][] = [
    ['1 uH', '1R0', '0805', '1.2 A', '0.09 Ohm', 18],
    ['2.2 uH', '2R2', '0805', '0.9 A', '0.14 Ohm', 18],
    ['4.7 uH', '4R7', '0805', '0.7 A', '0.22 Ohm', 19],
    ['10 uH', '100', '0805', '0.5 A', '0.38 Ohm', 21],
    ['1 uH', '1R0', '1206', '2 A', '0.05 Ohm', 26],
    ['2.2 uH', '2R2', '1206', '1.6 A', '0.08 Ohm', 26],
    ['4.7 uH', '4R7', '1206', '1.2 A', '0.13 Ohm', 27],
    ['10 uH', '100', '1206', '0.9 A', '0.21 Ohm', 29],
    ['22 uH', '220', '1206', '0.6 A', '0.42 Ohm', 31],
    ['47 uH', '470', '1206', '0.4 A', '0.85 Ohm', 34],
    ['100 uH', '101', '1206', '0.3 A', '1.7 Ohm', 39],
  ];
  return rows.map(([value, code, pkg, current, dcr, price]) => ({
    category: 'inductors',
    manufacturer: 'MGC',
    mpn: `MGC-PI${pkg}-${code}`,
    name: `Power inductor ${value} ${current} ${pkg}`,
    description:
      'Shielded multilayer power inductor for small DC-DC converters and supply filters.',
    package: pkg,
    specs: [
      ['Inductance', value],
      ['Current rating', current],
      ['DC resistance', dcr],
      ['Tolerance', '20%'],
    ],
    basePriceCents: price,
  }));
}

function diodes(): SeedProduct[] {
  const rows: [string, string, string, string, string, number, string][] = [
    [
      'Signal',
      'SD100',
      'SOD-123',
      '100 V',
      '0.15 A',
      5,
      'Fast switching diode for clamps and logic level work.',
    ],
    [
      'Signal',
      'SD75',
      'SOD-123',
      '75 V',
      '0.3 A',
      5,
      'Fast switching diode for clamps and logic level work.',
    ],
    [
      'Schottky',
      'SK120',
      'SMA',
      '20 V',
      '1 A',
      11,
      'Low forward drop Schottky diode for reverse polarity protection.',
    ],
    [
      'Schottky',
      'SK140',
      'SMA',
      '40 V',
      '1 A',
      12,
      'Low forward drop Schottky diode for reverse polarity protection.',
    ],
    [
      'Schottky',
      'SK240',
      'SMA',
      '40 V',
      '2 A',
      16,
      'Low forward drop Schottky diode for buck converters.',
    ],
    [
      'Schottky',
      'SK360',
      'SMA',
      '60 V',
      '3 A',
      22,
      'Low forward drop Schottky diode for buck converters.',
    ],
    [
      'Zener',
      'ZD33',
      'SOD-123',
      '3.3 V',
      '0.5 W',
      6,
      'Voltage reference and simple clamp, 3.3 V nominal.',
    ],
    [
      'Zener',
      'ZD51',
      'SOD-123',
      '5.1 V',
      '0.5 W',
      6,
      'Voltage reference and simple clamp, 5.1 V nominal.',
    ],
    [
      'Zener',
      'ZD120',
      'SOD-123',
      '12 V',
      '0.5 W',
      6,
      'Voltage reference and simple clamp, 12 V nominal.',
    ],
    ['TVS', 'TV05', 'SMA', '5 V', '400 W', 18, 'Transient suppressor for 5 V lines and USB power.'],
    ['TVS', 'TV12', 'SMA', '12 V', '400 W', 18, 'Transient suppressor for 12 V supply inputs.'],
    ['TVS', 'TV24', 'SMA', '24 V', '400 W', 19, 'Transient suppressor for 24 V industrial inputs.'],
    [
      'Rectifier',
      'RD1000',
      'Axial',
      '1000 V',
      '1 A',
      7,
      'General purpose axial rectifier for mains side circuits.',
    ],
    [
      'Rectifier',
      'RD400',
      'Axial',
      '400 V',
      '1 A',
      6,
      'General purpose axial rectifier for mains side circuits.',
    ],
  ];
  return rows.map(([type, code, pkg, voltage, rating, price, description]) => ({
    category: 'diodes',
    manufacturer: 'QLN',
    mpn: `QLN-${code}`,
    name: `${type} diode ${voltage} ${pkg}`,
    description,
    package: pkg,
    specs: [
      ['Type', type],
      ['Reverse voltage', voltage],
      [type === 'Zener' || type === 'TVS' ? 'Power' : 'Forward current', rating],
      ['Operating temperature', '-55 to 150 C'],
    ],
    basePriceCents: price,
  }));
}

function leds(): SeedProduct[] {
  const colours: [string, string, string, string][] = [
    ['Red', 'R', '2.0 V', '625 nm'],
    ['Amber', 'A', '2.0 V', '590 nm'],
    ['Green', 'G', '3.0 V', '525 nm'],
    ['Blue', 'B', '3.1 V', '470 nm'],
    ['White', 'W', '3.1 V', '6000 K'],
  ];
  const parts: SeedProduct[] = [];
  for (const [colour, code, forward, wavelength] of colours) {
    for (const [pkg, series, price] of [
      ['0603', 'CL06', 6],
      ['Radial 5 mm', 'TH05', 8],
    ] as const) {
      parts.push({
        category: 'leds',
        manufacturer: 'LMF',
        mpn: `LMF-${series}-${code}`,
        name: `${colour} LED ${pkg}`,
        description: `${colour} indicator LED, specified at 20 mA. Pair it with a series resistor sized for your supply.`,
        package: pkg,
        specs: [
          ['Colour', colour],
          ['Forward voltage', forward],
          [colour === 'White' ? 'Colour temperature' : 'Wavelength', wavelength],
          ['Test current', '20 mA'],
        ],
        basePriceCents: price + (colour === 'Blue' || colour === 'White' ? 3 : 0),
      });
    }
  }
  return parts;
}

function transistors(): SeedProduct[] {
  const rows: [string, string, string, string, string, string, number][] = [
    ['NPN', 'BT45N', 'SOT-23', '45 V', '0.1 A', '0.25 W', 5],
    ['PNP', 'BT45P', 'SOT-23', '45 V', '0.1 A', '0.25 W', 5],
    ['NPN', 'BT60N', 'SOT-23', '60 V', '0.6 A', '0.35 W', 7],
    ['PNP', 'BT60P', 'SOT-23', '60 V', '0.6 A', '0.35 W', 7],
    ['NPN', 'BT40T', 'TO-92', '40 V', '0.2 A', '0.6 W', 8],
    ['PNP', 'BT40U', 'TO-92', '40 V', '0.2 A', '0.6 W', 8],
    ['N-channel MOSFET', 'FN30S', 'SOT-23', '30 V', '3 A', '1.2 W', 14],
    ['P-channel MOSFET', 'FP30S', 'SOT-23', '30 V', '2.5 A', '1.2 W', 16],
    ['N-channel MOSFET', 'FN60S', 'SOT-23', '60 V', '0.3 A', '0.35 W', 11],
    ['N-channel MOSFET', 'FN60T', 'TO-220', '60 V', '30 A', '75 W', 69],
    ['N-channel MOSFET', 'FN100T', 'TO-220', '100 V', '20 A', '75 W', 82],
    ['P-channel MOSFET', 'FP60T', 'TO-220', '60 V', '18 A', '60 W', 91],
  ];
  return rows.map(([type, code, pkg, voltage, current, power, price]) => ({
    category: 'transistors',
    manufacturer: 'QLN',
    mpn: `QLN-${code}`,
    name: `${type} ${voltage} ${current} ${pkg}`,
    description: type.includes('MOSFET')
      ? 'Logic level MOSFET for load switching and motor drivers.'
      : 'General purpose bipolar transistor for switching and small signal amplifiers.',
    package: pkg,
    specs: [
      ['Type', type],
      ['Max voltage', voltage],
      ['Max current', current],
      ['Power dissipation', power],
    ],
    basePriceCents: price,
  }));
}

function regulators(): SeedProduct[] {
  const ldo: [string, string, string, string, number][] = [
    ['1.8 V', 'LDO18', 'SOT-23-5', '0.3 A', 24],
    ['2.5 V', 'LDO25', 'SOT-23-5', '0.3 A', 24],
    ['3.3 V', 'LDO33', 'SOT-23-5', '0.3 A', 24],
    ['5 V', 'LDO50', 'SOT-23-5', '0.3 A', 24],
    ['1.8 V', 'LDH18', 'SOT-223', '1 A', 38],
    ['3.3 V', 'LDH33', 'SOT-223', '1 A', 38],
    ['5 V', 'LDH50', 'SOT-223', '1 A', 38],
  ];
  const buck: [string, string, string, string, string, number][] = [
    ['3.3 V', 'BK33A', 'SOIC-8', '1 A', '4.5 to 28 V', 96],
    ['5 V', 'BK50A', 'SOIC-8', '1 A', '6.5 to 28 V', 96],
    ['3.3 V', 'BK33B', 'SOIC-8', '2 A', '4.5 to 36 V', 128],
    ['5 V', 'BK50B', 'SOIC-8', '2 A', '6.5 to 36 V', 128],
    ['3.3 V', 'BK33C', 'QFN-24', '3 A', '4.5 to 36 V', 174],
    ['5 V', 'BK50C', 'QFN-24', '3 A', '6.5 to 36 V', 174],
  ];
  return [
    ...ldo.map(([voltage, code, pkg, current, price]): SeedProduct => ({
      category: 'regulators',
      manufacturer: 'OPD',
      mpn: `OPD-${code}`,
      name: `LDO regulator ${voltage} ${current} ${pkg}`,
      description:
        'Low dropout linear regulator with thermal shutdown. Stable with small ceramic output capacitors.',
      package: pkg,
      specs: [
        ['Output voltage', voltage],
        ['Output current', current],
        ['Topology', 'Linear LDO'],
        ['Max input', '16 V'],
      ],
      basePriceCents: price,
    })),
    ...buck.map(([voltage, code, pkg, current, input, price]): SeedProduct => ({
      category: 'regulators',
      manufacturer: 'OPD',
      mpn: `OPD-${code}`,
      name: `Buck converter ${voltage} ${current} ${pkg}`,
      description:
        'Synchronous step-down converter with internal switches. Needs one inductor and a few capacitors.',
      package: pkg,
      specs: [
        ['Output voltage', voltage],
        ['Output current', current],
        ['Topology', 'Synchronous buck'],
        ['Input range', input],
      ],
      basePriceCents: price,
    })),
  ];
}

function microcontrollers(): SeedProduct[] {
  const rows: [string, string, string, string, string, number][] = [
    ['TW32A1', 'QFN-24', '32 KB', '4 KB', '48 MHz', 94],
    ['TW32A2', 'QFN-24', '64 KB', '8 KB', '48 MHz', 118],
    ['TW32A3', 'QFN-32', '64 KB', '8 KB', '48 MHz', 126],
    ['TW32B1', 'QFN-32', '128 KB', '16 KB', '72 MHz', 164],
    ['TW32B2', 'LQFP-48', '128 KB', '16 KB', '72 MHz', 172],
    ['TW32B3', 'LQFP-48', '256 KB', '32 KB', '72 MHz', 214],
    ['TW32C1', 'LQFP-48', '256 KB', '64 KB', '120 MHz', 286],
    ['TW32C2', 'LQFP-64', '256 KB', '64 KB', '120 MHz', 298],
    ['TW32C3', 'LQFP-64', '512 KB', '128 KB', '120 MHz', 372],
    ['TW32D1', 'LQFP-64', '512 KB', '128 KB', '160 MHz', 448],
    ['TW32D2', 'LQFP-64', '1024 KB', '256 KB', '160 MHz', 566],
  ];
  return rows.map(([code, pkg, flash, ram, clock, price]) => ({
    category: 'microcontrollers',
    manufacturer: 'TW',
    mpn: `${code}-${pkg.replace(/\D/g, '')}`,
    name: `RV32 microcontroller ${flash} flash ${clock} ${pkg}`,
    description: `32-bit RV32IMC microcontroller with ${flash} of flash and ${ram} of RAM. Includes UART, SPI, I2C and a 12-bit ADC.`,
    package: pkg,
    specs: [
      ['Core', 'RV32IMC'],
      ['Flash', flash],
      ['RAM', ram],
      ['Clock', clock],
      ['Supply voltage', '1.8 to 3.6 V'],
    ],
    basePriceCents: price,
  }));
}

function sensors(): SeedProduct[] {
  const rows: [string, string, string, string, string, string, number][] = [
    ['Temperature', 'TS10', 'SOT-23-5', 'I2C', '2.7 to 5.5 V', '+/-0.5 C', 86],
    ['Temperature', 'TS20', 'SOIC-8', 'SPI', '2.7 to 5.5 V', '+/-0.25 C', 142],
    ['Temperature', 'TS05', 'SOT-23', 'Analog', '2.4 to 5.5 V', '+/-2 C', 42],
    ['Humidity', 'HM30', 'QFN-24', 'I2C', '1.8 to 3.6 V', '+/-2% RH', 312],
    ['Pressure', 'PR12', 'QFN-24', 'I2C', '1.8 to 3.6 V', '+/-1 hPa', 268],
    ['Pressure', 'PR14', 'QFN-24', 'SPI', '1.8 to 3.6 V', '+/-0.5 hPa', 344],
    ['Acceleration', 'AC22', 'QFN-24', 'I2C', '1.7 to 3.6 V', '+/-16 g', 228],
    ['Acceleration', 'AC24', 'QFN-24', 'SPI', '1.7 to 3.6 V', '+/-16 g', 236],
    ['Ambient light', 'AL08', 'SOT-23-5', 'I2C', '2.4 to 3.6 V', '0.1 to 40000 lux', 118],
    ['Current', 'CS20', 'SOIC-8', 'Analog', '4.5 to 5.5 V', '+/-20 A', 196],
  ];
  return rows.map(([measures, code, pkg, bus, supply, range, price]) => ({
    category: 'sensors',
    manufacturer: 'KSB',
    mpn: `KSB-${code}`,
    name: `${measures} sensor ${bus} ${pkg}`,
    description: `${measures} sensor with ${bus === 'Analog' ? 'an analog output' : `a digital ${bus} interface`}. Factory calibrated.`,
    package: pkg,
    specs: [
      ['Measures', measures],
      ['Interface', bus],
      ['Supply voltage', supply],
      ['Range or accuracy', range],
    ],
    basePriceCents: price,
  }));
}

function connectors(): SeedProduct[] {
  const headers: [number, number, number][] = [
    [1, 2, 6],
    [1, 3, 7],
    [1, 4, 8],
    [1, 6, 11],
    [1, 8, 14],
    [1, 10, 17],
    [1, 20, 31],
    [2, 3, 14],
    [2, 5, 19],
    [2, 10, 34],
    [2, 20, 62],
  ];
  const parts = headers.map(([rows, columns, price]): SeedProduct => ({
    category: 'connectors',
    manufacturer: 'FNK',
    mpn: `FNK-PH${rows}${String(columns).padStart(2, '0')}-S`,
    name: `Pin header ${rows}x${columns} 2.54 mm straight`,
    description: 'Straight through-hole pin header with gold flash contacts. Can be cut to length.',
    package: `Header ${rows}x${columns}`,
    specs: [
      ['Type', 'Pin header'],
      ['Positions', String(rows * columns)],
      ['Pitch', '2.54 mm'],
      ['Rated current', '3 A'],
    ],
    basePriceCents: price,
  }));
  parts.push(
    {
      category: 'connectors',
      manufacturer: 'FNK',
      mpn: 'FNK-UC16-MID',
      name: 'USB-C receptacle 16 pin mid mount',
      description: 'USB 2.0 Type-C receptacle with 16 contacts. Mid mount, for thin boards.',
      package: 'USB-C',
      specs: [
        ['Type', 'USB-C receptacle'],
        ['Positions', '16'],
        ['Rated current', '3 A'],
      ],
      basePriceCents: 64,
    },
    {
      category: 'connectors',
      manufacturer: 'FNK',
      mpn: 'FNK-UC24-TOP',
      name: 'USB-C receptacle 24 pin top mount',
      description: 'Full featured Type-C receptacle with 24 contacts. Top mount.',
      package: 'USB-C',
      specs: [
        ['Type', 'USB-C receptacle'],
        ['Positions', '24'],
        ['Rated current', '5 A'],
      ],
      basePriceCents: 112,
    },
  );
  return parts;
}

export function buildSeedProducts(): SeedProduct[] {
  return [
    ...resistors(),
    ...capacitors(),
    ...inductors(),
    ...diodes(),
    ...leds(),
    ...transistors(),
    ...regulators(),
    ...microcontrollers(),
    ...sensors(),
    ...connectors(),
  ];
}
