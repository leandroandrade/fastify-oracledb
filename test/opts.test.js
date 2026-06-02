'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const plugin = require('../plugin')
const Fastify = require('fastify')
const oracledb = require('oracledb')

const poolOptions = {
  user: 'oracle', // Usuário do banco de dados Oracle -- admin, root, oracle
  password: 'oracle', // Senha do banco de dados Oracle
  connectString: '127.0.0.1:1521/FREEPDB1' // Conexão do banco de dados Oracle
}

test('client must be instance of oracledb.pool', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { client: 'hello world' })

  try {
    await fastify.ready()
    assert.fail('should have thrown')
  } catch (err) {
    assert.equal(err.message, 'fastify-oracledb: supplied client must be an instance of oracledb.pool')
    await fastify.close()
  }
})

test('duplicate connection names should throw', async () => {
  const fastify = Fastify()
  fastify
    .register(plugin, { pool: poolOptions, name: 'testdb' })
    .register(plugin, { pool: poolOptions, name: 'testdb' })

  try {
    await fastify.ready()
    assert.fail('should have thrown')
  } catch (err) {
    assert.equal(err.message, 'fastify-oracledb: connection name "testdb" has already been registered')
    await fastify.close()
  }
})

test('duplicate plugin registration should throw', async () => {
  const fastify = Fastify()

  fastify
    .register(plugin, { pool: poolOptions })
    .register(plugin, { pool: poolOptions })

  try {
    await fastify.ready()
    assert.fail('should have thrown')
  } catch (err) {
    assert.equal(err.message, 'fastify-oracledb has already been registered')
    await fastify.close()
  }
})

test('should throw if no pool option is provided', async () => {
  const fastify = Fastify()

  fastify.register(plugin, {})

  try {
    await fastify.ready()
    assert.fail('should have thrown')
  } catch (err) {
    assert.equal(err.message, 'fastify-oracledb: must supply options.pool oracledb pool options')
    await fastify.close()
  }
})

test('should throw if could not get pool alias', async () => {
  const fastify = Fastify()

  fastify.register(plugin, { poolAlias: 'test' })

  try {
    await fastify.ready()
    assert.fail('should have thrown')
  } catch (err) {
    assert.match(err.message, /fastify-oracledb: could not get pool alias/)
    await fastify.close()
  }
})

test('should throw if pool cannot be created', async () => {
  const fastify = Fastify()

  fastify.register(plugin, { pool: { poolMin: -5 } })

  try {
    await fastify.ready()
    assert.fail('should have thrown')
  } catch (err) {
    assert.match(err.message, /fastify-oracledb: failed to create pool/)
    await fastify.close()
  }
})

test('sets OBJECT as default outFormat', async () => {
  const fastify = Fastify()
  oracledb.outFormat = oracledb.ARRAY

  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })

  await fastify.ready()
  assert.ok(fastify.oracle.pool)
  assert.equal(fastify.oracle.db.outFormat, fastify.oracle.db.OBJECT)
  oracledb.outFormat = oracledb.ARRAY
  await fastify.close()
})

test('sets fetchAsString values', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, fetchAsString: ['NUMBER'] })

  await fastify.ready()
  assert.ok(fastify.oracle.pool)
  assert.deepEqual(fastify.oracle.db.fetchAsString, [fastify.oracle.db.NUMBER])
  await fastify.close()
})
