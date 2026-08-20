import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert, dimensionOf, supportedUnits } from '../src/units.ts';

test('length: km to m', () => {
  assert.equal(convert(1, 'km', 'm').value, 1000);
});

test('length: mi to ft', () => {
  const { value } = convert(1, 'mi', 'ft');
  assert.ok(Math.abs(value - 5280) < 1e-9);
});

test('mass: lb to kg', () => {
  const { value } = convert(1, 'lb', 'kg');
  assert.ok(Math.abs(value - 0.45359237) < 1e-9);
});

test('time: h to s', () => {
  assert.equal(convert(1, 'h', 's').value, 3600);
});

test('temperature: C to F', () => {
  assert.equal(convert(100, 'C', 'F').value, 212);
});

test('temperature: F to K', () => {
  const { value } = convert(32, 'F', 'K');
  assert.ok(Math.abs(value - 273.15) < 1e-9);
});

test('temperature round trip is stable', () => {
  const { value: f } = convert(37, 'C', 'F');
  const { value: c } = convert(f, 'F', 'C');
  assert.ok(Math.abs(c - 37) < 1e-9);
});

test('converting a unit to itself is a no-op', () => {
  assert.equal(convert(42, 'kg', 'kg').value, 42);
});

test('mismatched dimensions throw', () => {
  assert.throws(() => convert(1, 'km', 'kg'));
});

test('unknown units throw', () => {
  assert.throws(() => convert(1, 'furlong', 'm'));
  assert.throws(() => convert(1, 'm', 'furlong'));
});

test('non-finite values throw', () => {
  assert.throws(() => convert(NaN, 'km', 'm'));
  assert.throws(() => convert(Infinity, 'km', 'm'));
});

test('result carries the resolved dimension', () => {
  assert.equal(convert(1, 'km', 'm').dimension, 'length');
  assert.equal(convert(0, 'C', 'F').dimension, 'temperature');
});

test('dimensionOf resolves known units and rejects unknown ones', () => {
  assert.equal(dimensionOf('kg'), 'mass');
  assert.equal(dimensionOf('bogus'), null);
});

test('supportedUnits lists every unit once, temperature included', () => {
  const units = supportedUnits();
  assert.equal(new Set(units).size, units.length);
  for (const u of ['m', 'kg', 's', 'C', 'F', 'K']) {
    assert.ok(units.includes(u));
  }
});
