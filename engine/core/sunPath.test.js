import assert from 'node:assert/strict';
import { sunFromHours, sunPathFrom, SUN_PATH_DEFAULT } from './sunPath.js';

let checks = 0;
function near(actual, expected, eps = 1e-9) { checks++; assert.ok(Math.abs(actual - expected) <= eps, `${actual} != ${expected}`); }
function ok(value) { checks++; assert.ok(value); }
const path = SUN_PATH_DEFAULT, out = { elevationDeg: 0, azimuthDeg: 0 };
let previous = -1;
for (let h = 6; h <= 12; h += 0.25) {
  const elevation = sunFromHours(h, path, out).elevationDeg;
  ok(elevation > previous); previous = elevation;
  near(sunFromHours(h, path, out).elevationDeg, sunFromHours(24 - h, path).elevationDeg);
}
const noon = sunFromHours(12, path).elevationDeg;
near(noon, 90 - path.latDeg);
for (let h = 0; h <= 24; h += 0.25) ok(sunFromHours(h, path, out).elevationDeg <= noon);
for (const [hour, az] of [[6, 90], [12, 180], [18, 270]]) near(sunFromHours(hour, path, out).azimuthDeg, az);
for (let h = 6.25; h < 12; h += 0.25) {
  const az = sunFromHours(h, path, out).azimuthDeg;
  ok(az > 90 && az < 180);
}
ok(sunFromHours(3, path, out).elevationDeg < 0);
ok(sunFromHours(21, path, out).elevationDeg < 0);
for (const [h, wrapped] of [[30, 6], [-2, 22]]) {
  const a = sunFromHours(h, path), b = sunFromHours(wrapped, path);
  near(a.elevationDeg, b.elevationDeg); near(a.azimuthDeg, b.azimuthDeg);
}
near(path.h0, 10.1658, 1e-3);
near(sunFromHours(path.h0, path, out).elevationDeg, 60);
near(out.azimuthDeg, 112.5);
const afternoon = sunPathFrom({ elevation: 60, azimuth: 247.5 });
near(afternoon.h0, 13.834, 1e-3);
near(sunFromHours(afternoon.h0, afternoon, out).elevationDeg, 60);
near(out.azimuthDeg, 247.5);
ok(sunFromHours(8, path, out) === out);
ok(sunFromHours(16, path, out) === out);
near(sunFromHours(6, path, out).elevationDeg, 0, 0);
near(sunFromHours(18, path, out).elevationDeg, 0, 0);
console.log(`sunPath: ${checks} assertions PASS`);
