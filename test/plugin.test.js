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

test('creates pool from config', async () => {
  const fastify = Fastify()

  fastify.register(plugin, { pool: poolOptions, drainTime: 0 })
  await fastify.ready()

  assert.ok(fastify.oracle.pool)
  const conn = await fastify.oracle.getConnection()
  const result = await conn.execute('SELECT 1 AS FOO FROM DUAL', {}, { outFormat: fastify.oracle.db.OBJECT })
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].FOO, 1)

  // Note that we don't explicity close the connection here.
  // This tests the drainTime option since if a drainTime is not given,
  // then any open connections should be released with connection.close() before fastify.close() is called,
  // otherwise the underlying pool close will fail and the pool will remain open.
  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('creates named pool from config', async () => {
  const fastify = Fastify()

  fastify.register(plugin, { pool: poolOptions, name: 'testdb' })
  await fastify.ready()

  assert.ok(fastify.oracle.pool)
  assert.ok(fastify.oracle.testdb.pool)
  const conn = await fastify.oracle.getConnection()
  const result = await conn.execute('SELECT 1 AS FOO FROM DUAL', {}, { outFormat: fastify.oracle.db.OBJECT })
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].FOO, 1)

  await conn.close()
  await fastify.close()

  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
  assert.equal(fastify.oracle.testdb.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('accepts singleton client', async () => {
  const fastify = Fastify()

  const pool = await oracledb.createPool(poolOptions)
  fastify.register(plugin, { client: pool })
  await fastify.ready()

  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_OPEN)
  assert.equal(fastify.oracle.db, oracledb)
  assert.equal(fastify.oracle.pool, pool)

  await fastify.close()

  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('retrieves a cached pool', async () => {
  const fastify = Fastify()
  const opts = Object.assign({}, poolOptions)

  const pool = await oracledb.createPool(Object.assign(opts, { poolAlias: 'foo' }))
  fastify.register(plugin, { poolAlias: 'foo' })

  await fastify.ready()

  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_OPEN)
  assert.equal(fastify.oracle.db, oracledb)
  assert.equal(fastify.oracle.pool, pool)

  await fastify.close()

  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('transact with async/await', async () => {
  const fastify = Fastify()

  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const { rows } = await fastify.oracle.transact(async conn => {
    const res = await conn.execute('SELECT * FROM DUAL')
    assert.deepEqual(res.rows, [{ DUMMY: 'X' }])

    return conn.execute('SELECT * FROM DUAL')
  })

  assert.deepEqual(rows, [{ DUMMY: 'X' }])
  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('transact with promise', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const res = await fastify.oracle.transact(conn => {
    return conn.execute('SELECT * FROM DUAL')
  })

  assert.deepEqual(res.rows, [{ DUMMY: 'X' }])

  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('transact with callback', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const result = await new Promise((resolve, reject) => {
    fastify.oracle.transact(conn => {
      return conn.execute('SELECT * FROM DUAL')
    }, function (err, result) {
      if (err) return reject(err)
      resolve(result)
    })
  })

  assert.deepEqual(result.rows, [{ DUMMY: 'X' }])

  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('transact with commit callback', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const res = await new Promise((resolve, reject) => {
    fastify.oracle.transact((conn, commit) => {
      conn.execute('SELECT * FROM DUAL', function (err, result) {
        commit(err, result)
      })
    }, function (err, res) {
      if (err) return reject(err)
      resolve(res)
    })
  })

  assert.deepEqual(res.rows, [{ DUMMY: 'X' }])

  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('transact with promise (error)', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  await assert.rejects(
    fastify.oracle.transact(conn => conn.execute('SELECT * FROM ??')),
    /ORA-00911/
  )

  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('transact with callback (error)', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const { err, res } = await new Promise((resolve) => {
    fastify.oracle.transact(conn => {
      return conn.execute('SELECT * FROM ??')
    },
    function (err, res) {
      resolve({ err, res })
    })
  })

  assert.equal(res, undefined)
  assert.match(err.message, /ORA-00911/)

  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('transact with commit callback (error)', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const { err, res } = await new Promise((resolve) => {
    fastify.oracle.transact((conn, commit) => {
      conn.execute('SELECT * FROM ??', function (err, result) {
        commit(err, result)
      })
    }, function (err, res) {
      resolve({ err, res })
    })
  })

  assert.equal(res, undefined)
  assert.match(err.message, /ORA-00911/)

  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('transact should fail if connection pool is invalid', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: {}, outFormat: 'OBJECT' })

  try {
    await fastify.ready()
    await fastify.oracle.transact(conn => {
      return conn.execute('SELECT * FROM DUAL')
    })
    assert.fail('should have thrown')
  } catch (err) {
    assert.match(err.message, /fastify-oracledb: failed to create pool-NJS-/)
    await fastify.close()
  }
})

test('transact commit should error if connection drops', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const { err, res } = await new Promise((resolve) => {
    fastify.oracle.transact((conn, commit) => {
      conn.execute('SELECT * FROM DUAL', function (err, result) {
        conn.close(() => {
          commit(err, result)
        })
      })
    }, function (err, res) {
      resolve({ err, res })
    })
  })

  assert.equal(res, undefined)
  assert.match(err.message, /NJS-003/)

  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('query with async/await', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const { rows } = await fastify.oracle.query('SELECT * FROM DUAL')

  assert.deepEqual(rows, [{ DUMMY: 'X' }])
  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('query with async/await + values', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const { rows } = await fastify.oracle.query('SELECT * FROM DUAL WHERE 1 = :v', [1])

  assert.deepEqual(rows, [{ DUMMY: 'X' }])
  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('query with async/await + values + options', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const { rows } = await fastify.oracle.query('SELECT * FROM DUAL WHERE 1 = :v', [1], { outFormat: oracledb.ARRAY })

  assert.deepEqual(rows, [['X']])
  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('query with promise', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const res = await fastify.oracle.query('SELECT * FROM DUAL')
  assert.deepEqual(res.rows, [{ DUMMY: 'X' }])

  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('query with callback', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const res = await new Promise((resolve, reject) => {
    fastify.oracle.query('SELECT * FROM DUAL', function (err, res) {
      if (err) return reject(err)
      resolve(res)
    })
  })

  assert.deepEqual(res.rows, [{ DUMMY: 'X' }])

  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('query with callback + values', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const res = await new Promise((resolve, reject) => {
    fastify.oracle.query('SELECT * FROM DUAL WHERE 1 = :v', [1], function (err, res) {
      if (err) return reject(err)
      resolve(res)
    })
  })

  assert.deepEqual(res.rows, [{ DUMMY: 'X' }])

  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('query with callback + values + options', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const res = await new Promise((resolve, reject) => {
    fastify.oracle.query('SELECT * FROM DUAL WHERE 1 = :v', [1], { outFormat: oracledb.ARRAY }, function (err, res) {
      if (err) return reject(err)
      resolve(res)
    })
  })

  assert.deepEqual(res.rows, [['X']])

  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('query with promise (error)', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  await assert.rejects(
    fastify.oracle.query('SELECT * FROM ??'),
    /ORA-00911/
  )

  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('query with callback (error)', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: poolOptions, outFormat: 'OBJECT' })
  await fastify.ready()

  const { err, res } = await new Promise((resolve) => {
    fastify.oracle.query('SELECT * FROM ??', function (err, res) {
      resolve({ err, res })
    })
  })

  assert.equal(res, undefined)
  assert.match(err.message, /ORA-00911/)

  await fastify.close()
  assert.equal(fastify.oracle.pool.status, fastify.oracle.db.POOL_STATUS_CLOSED)
})

test('query should fail if connection pool is invalid', async () => {
  const fastify = Fastify()
  fastify.register(plugin, { pool: {}, outFormat: 'OBJECT' })

  try {
    await fastify.ready()
    await fastify.oracle.query('SELECT * FROM DUAL')
    assert.fail('should have thrown')
  } catch (err) {
    assert.match(err.message, /fastify-oracledb: failed to create pool-NJS-/)
    await fastify.close()
  }
})
