export interface KbaVehicleRecord {
  id: string;
  make: string;
  model: string;
  year: number;
  hsn: string;
  tsn: string;
  engine: string;
  tuvIntervalMonths: number;
  registrations: {
    plate: string;
    vin: string;
    tuvDueDate: string;
  }[];
}

export const kbaDatabase: readonly KbaVehicleRecord[] = [
  {
    id: 'vw-golf-vii-16-tdi',
    make: 'Volkswagen',
    model: 'Golf VII 1.6 TDI',
    year: 2018,
    hsn: '0603',
    tsn: 'BQV',
    engine: '1,6 l Diesel, 85 kW',
    tuvIntervalMonths: 24,
    registrations: [{ plate: 'S-WN 1234', vin: 'WVWZZZAUZJW123456', tuvDueDate: '2027-05-31' }],
  },
  {
    id: 'bmw-320d-touring',
    make: 'BMW',
    model: '320d Touring',
    year: 2020,
    hsn: '0005',
    tsn: 'CKE',
    engine: '2,0 l Diesel, 140 kW',
    tuvIntervalMonths: 24,
    registrations: [{ plate: 'WN-AB 88', vin: 'WBA8E91070K123456', tuvDueDate: '2027-09-30' }],
  },
  {
    id: 'mercedes-c-200',
    make: 'Mercedes-Benz',
    model: 'C 200',
    year: 2019,
    hsn: '1313',
    tsn: 'DHL',
    engine: '1,5 l Benzin, 135 kW',
    tuvIntervalMonths: 24,
    registrations: [{ plate: 'ES-KM 240', vin: 'WDD2050401R123456', tuvDueDate: '2027-02-28' }],
  },
  {
    id: 'audi-a4-avant-20-tdi',
    make: 'Audi',
    model: 'A4 Avant 2.0 TDI',
    year: 2017,
    hsn: '0588',
    tsn: 'BHR',
    engine: '2,0 l Diesel, 110 kW',
    tuvIntervalMonths: 24,
    registrations: [{ plate: 'WN-SD 77', vin: 'WAUZZZ8K9DA123456', tuvDueDate: '2027-11-30' }],
  },
];
