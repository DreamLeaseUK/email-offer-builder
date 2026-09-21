import { describe, expect, it } from 'vitest';
import { OfferPageError, parseOfferPage } from '../src/index.js';
import { Rewriter, fixture } from './helpers.js';

describe('parseOfferPage', () => {
  it('decodes the HTML entities the site leaves in a name: a Renault 5 "Techno + Comfort Range" is not shown as "&#x2B;"', async () => {
    const html = fixture('offer-page-personal.html').replaceAll('390kW Excellence AWD 83kWh 4dr Auto', '110kW Techno &#x2B; Comfort Range 52kWh 5dr Auto').replace("motorleaseInit.model = 'Seal'", "motorleaseInit.model = 'Citro&euml;n &amp; Co &#39;5&#39;'");
    const page = await parseOfferPage(html, Rewriter);
    expect(page.derivative).toBe('110kW Techno + Comfort Range 52kWh 5dr Auto');
    expect(page.derivative).not.toMatch(/&#|&[a-z]+;/i);
    // the slugs go back to the site's own API: they are never rewritten
    expect(page.slugs.derivative).toBe('390kw-excellence-awd-83kwh-4dr-auto');
  });

  it('reads identity, slugs, defaults, fees, stats and the image from a personal EV page', async () => {
    const page = await parseOfferPage(fixture('offer-page-personal.html'), Rewriter);
    expect(page.make).toBe('BYD');
    expect(page.model).toBe('Seal');
    expect(page.derivative).toBe('390kW Excellence AWD 83kWh 4dr Auto');
    expect(page.slugs).toEqual({ manufacturer: 'byd', model: 'seal', bodyStyle: 'saloon', derivative: '390kw-excellence-awd-83kwh-4dr-auto' });
    expect(page.transmission).toBe('Automatic');
    expect(page.bodyStyle).toBe('Saloon');
    expect(page.doors).toBe(4);
    expect(page.fuelType).toBe('Electric');
    expect(page.isBusiness).toBe(false);
    expect(page.isVan).toBe(false);
    expect(page.tags).toEqual([]);
    expect(page.defaults).toEqual({ initialRental: 12, contractLength: 48, annualMileage: 6000, includeMaintenance: false, financeType: 'Personal Contract Hire' });
    expect(page.processingFee).toEqual({ personal: 299.99, business: 249.99 });
    expect(page.stats).toEqual([
      { value: '3.8', unit: 'secs', label: '0 to 62 mph' },
      { value: '530', unit: 'bhp', label: 'Engine power' },
      { value: '323', unit: 'mi', label: 'Combined range' },
      { value: '82.5', unit: 'kWh', label: 'Battery capacity' },
      { value: '8', unit: 'yrs', label: 'Battery warranty' },
    ]);
    expect(page.imageSourceUrl).toBe('https://images.example.invalid/vehicle.webp?viewPoint=1');
    expect(page.ldPrice).toBe(347.8);
  });

  it('reads a petrol SUV page with a site tag and ICE stats', async () => {
    const page = await parseOfferPage(fixture('offer-page-suv-petrol.html'), Rewriter);
    expect(page.make).toBe('Nissan');
    expect(page.model).toBe('Juke');
    expect(page.bodyStyle).toBe('SUV');
    expect(page.slugs.bodyStyle).toBe('suv');
    expect(page.transmission).toBe('Manual');
    expect(page.doors).toBe(5);
    expect(page.fuelType).toBe('Petrol');
    expect(page.tags).toEqual(['Limited Stock']);
    expect(page.defaults.contractLength).toBe(60);
    expect(page.stats.map((s) => s.label)).toEqual(['CO2 emissions', 'Fuel efficiency', '0 to 62 mph', 'Engine power']);
    expect(page.stats[0]).toEqual({ value: '131', unit: 'g/km', label: 'CO2 emissions' });
  });

  it('refuses a page without the vehicle data block', async () => {
    await expect(parseOfferPage('<html><body><h1>Not an offer</h1></body></html>', Rewriter)).rejects.toThrow(OfferPageError);
  });
});
