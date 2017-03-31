import EventEmitter from 'events'
import deepFreeze from 'deep-freeze'

import { validateFileShareDoc } from './fileShareDoc'
import E from '../lib/error'
import { assert } from '../lib/types'

class FileShare {

  constructor(digest, doc) {
    this.digest = digest
    this.doc = doc

    deepFreeze(this)
  }

  userAuthorizedToRead(userUUID) {
    return [...this.doc.writelist, ...this.doc.readlist].includes(userUUID)
  }

  userAuthorizedToWrite(userUUID) {
    return this.doc.writelist.includes(userUUID)
  }

  // filter collection
  // author of the share still has permission to share these nodes
  effective(fileData) {
    return this.doc.collection.filter(uuid => fileData.userPermittedToShareByUUID(this.doc.author, uuid))
  }
}

const invariantProps = (c, n, props) => {
  props.forEach(prop => {
    assert(c[prop] === n[prop], 'invariant has changed')
  })
}

const invariantUpdate = (c, n) => {
  invariantProps(c, n, [
    'doctype', 'docversion', 'uuid', 'author', 'ctime'
  ])
}

// whether a node is included in a share and still effective
// const nodeIncluded = (share, node, fileData) => {
//   let collection = share.effective(fileData)
//   return collection.find(uuid => node.nodepath().includes(fileData.uuidMap.get(uuid)))
// }

class FileShareData extends EventEmitter {

  constructor(model, fileShareStore, fileData) {
    super()
    this.model = model
    this.fileShareStore = fileShareStore
    this.fileShareMap = new Map()
    this.fileData = fileData
  }

  async load() {
    let shares = await this.fileShareStore.retrieveAllAsync()
    shares.forEach(share => {
      this.fileShareMap.set(share.doc.uuid, share)
    })
    this.emit('fileShareCreated', shares)
  }

  findShareCollectionByUUID(uuid) {
    return this.fileShareMap.get(uuid) 
      ? this.fileShareMap.get(uuid).doc.collection : null
  }

  findShareByUUID(uuid) {
    return this.fileShareMap.get(uuid)
  }
  
  userAuthorizedToRead(userUUID, node) { // starting from root
    // 1. filter user in ReaderSet and user is not author
    // 2. iterate collection list, find one in nodepath && effective

    let shares = [...this.fileShareMap.values()]

    for (let i = 0; i < shares.length; i++) {
      if (shares[i].userAuthorizedToRead(userUUID)) {
        let collection = shares[i].effective(this.fileData)

        let found = collection.find(uuid => {
          let n = this.fileData.findNodeByUUID(uuid)
          let nodepath = node.nodepath()
          return nodepath.includes(n) && this.fileData.userPermittedToRead(share[i].doc.author, n)
        })
        if (found) return true
      }
    }
    return false
  }

  userAuthorizedToWrite(userUUID, node) {
    let shares = [...this.fileShareMap.values()]

    for (let i = 0; i < shares.length; i++) {
      if (shares[i].userAuthorizedToWrite(userUUID)) {
        let collection = shares[i].effective(this.fileData)

        let found = collection.find(uuid => {
          let n = this.fileData.findNodeByUUID(uuid)
          let nodepath = node.nodepath()
          return nodepath.includes(n) && this.fileData.userPermittedToWrite(share[i].doc.author, n)
        })
        if (found) return true
      }
    }
    return false
  }

  async createFileShare(doc) {
    validateFileShareDoc(doc, this.model.getUsers())

    let digest = await this.fileShareStore.storeAsync(doc)
    let fileShare = new FileShare(digest, doc)
    this.fileShareMap.set(doc.uuid, fileShare)
    this.emit('fileShareCreated', [fileShare])
    return fileShare
  }

  async updateFileShare(doc) {
    validateFileShareDoc(doc, this.model.getUsers())

    let share = this.fileShareMap.get(doc.uuid)
    if(!share) throw new E.ENOENT()

    invariantUpdate(share.doc, doc)

    let digest = await this.fileShareStore.storeAsync(doc)
    let next = new FileShare(digest, doc)

    this.emit('fileShareUpdating', share, next)
    this.fileShareMap.set(doc.uuid, next)
    this.emit('fileShareUpdated', share, next)
    return next
  }

  async deleteFileShare(uuid) {
    let share = this.fileShareMap.get(uuid)
    if(!share) throw new E.ENOENT()

    await this.fileShareStore.archiveAsync(uuid)

    this.emit('fileShareDeleting', share)
    this.fileShareMap.delete(uuid)
  }
}

const createFileShareData = async (model, fileShareStore) => {
  Promise.promisifyAll(fileShareStore)
  let fileShareData = new FileShareData(model, fileShareStore)
  await fileShareData.load()
  return fileShareData
}

export { createFileShareData }
