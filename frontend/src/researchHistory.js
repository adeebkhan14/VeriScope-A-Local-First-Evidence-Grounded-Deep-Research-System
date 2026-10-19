const DATABASE_NAME = 'veriscope-research'
const DATABASE_VERSION = 1
const STORE_NAME = 'results'

let databasePromise

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('This browser does not support local research storage.'))
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('createdAt', 'createdAt')
          store.createIndex('saved', 'saved')
        }
      }

      request.onsuccess = () => {
        const database = request.result
        database.onversionchange = () => {
          database.close()
          databasePromise = undefined
        }
        resolve(database)
      }

      request.onerror = () => {
        databasePromise = undefined
        reject(request.error || new Error('Could not open local research storage.'))
      }

      request.onblocked = () => {
        databasePromise = undefined
        reject(new Error('Local research storage is busy in another tab. Close other VeriScope tabs and try again.'))
      }
    })
  }

  return databasePromise
}

function runTransaction(mode, operation) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)
    let result

    transaction.oncomplete = () => resolve(result)
    transaction.onabort = () => reject(transaction.error || new Error('Local research storage could not complete the operation.'))
    transaction.onerror = () => reject(transaction.error || new Error('Local research storage operation failed.'))

    try {
      operation(store, (value) => {
        result = value
      })
    } catch (error) {
      transaction.abort()
      reject(error)
    }
  }))
}

export function getResearchHistory() {
  return runTransaction('readonly', (store, setResult) => {
    const request = store.getAll()
    request.onsuccess = () => {
      const entries = request.result
      entries.sort((first, second) => second.createdAt.localeCompare(first.createdAt))
      setResult(entries)
    }
  })
}

export function addResearchResult(entry) {
  return runTransaction('readwrite', (store, setResult) => {
    const request = store.add(entry)
    request.onsuccess = () => setResult(entry)
  })
}

export function setResearchSaved(id, saved) {
  return runTransaction('readwrite', (store, setResult) => {
    const request = store.get(id)
    request.onsuccess = () => {
      if (!request.result) {
        setResult(null)
        return
      }
      const updated = { ...request.result, saved }
      store.put(updated)
      setResult(updated)
    }
  }).then((entry) => {
    if (!entry) {
      throw new Error('This research result is no longer in local history.')
    }
    return entry
  })
}

export function deleteResearchResult(id) {
  return runTransaction('readwrite', (store) => {
    store.delete(id)
  })
}

export function clearResearchHistory() {
  return runTransaction('readwrite', (store) => {
    store.clear()
  })
}
