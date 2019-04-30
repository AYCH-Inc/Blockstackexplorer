import { decrypt } from './encryption-utils'
import { payments } from 'bitcoinjs-lib'
import * as bip32 from 'bip32'
import crypto from 'crypto'
import log4js from 'log4js'

const logger = log4js.getLogger(__filename)

function hashCode(string) {
  let hash = 0
  if (string.length === 0) return hash
  for (let i = 0; i < string.length; i++) {
    const character = string.charCodeAt(i)
    hash = (hash << 5) - hash + character
    hash = hash & hash
  }
  return hash & 0x7fffffff
}

/**
 * @param {bip32.BIP32} node 
 */
export function getAddressFromBIP32Node(node) {
  return payments.p2pkh({ pubkey: node.publicKey }).address
}

const PUBLIC_SHARED_APPS_NODE_INDEX = 0
const APPS_NODE_INDEX = 0
const SIGNING_NODE_INDEX = 1
const ENCRYPTION_NODE_INDEX = 2
export const MAX_TRUST_LEVEL = 99

/**
 * @param {bip32.BIP32} appsNode 
 */
export function getSharedAppsPrivateKey(appsNode) {
  const intermediateNode = appsNode.deriveHardened(PUBLIC_SHARED_APPS_NODE_INDEX)
  // Use only the privateKey from this node from which to create new non-hardened master node 
  // (the regular BIP32 key hierarchy/chain is halted here). 
  return intermediateNode.privateKey
}

export class AppNode {
  /**
   * @param {bip32.BIP32} hdNode 
   */
  constructor(hdNode, appDomain) {
    this.hdNode = hdNode
    this.appDomain = appDomain
  }

  getAppPrivateKey() {
    return this.hdNode.privateKey.toString('hex')
  }

  getAddress() {
    return getAddressFromBIP32Node(this.hdNode)
  }
}

export class AppsNode {
  /**
   * @param {bip32.BIP32} appsHdNode 
   */
  constructor(appsHdNode, salt) {
    this.hdNode = appsHdNode
    this.salt = salt
  }

  getNode() {
    return this.hdNode
  }

  getAppNode(appDomain) {
    const hash = crypto
      .createHash('sha256')
      .update(`${appDomain}${this.salt}`)
      .digest('hex')
    const appIndex = hashCode(hash)
    const appNode = this.hdNode.deriveHardened(appIndex)
    return new AppNode(appNode, appDomain)
  }

  toBase58() {
    return this.hdNode.toBase58()
  }

  getSalt() {
    return this.salt
  }
}



class IdentityAddressOwnerNode {
  /**
   * @param {bip32.BIP32} ownerHdNode 
   */
  constructor(ownerHdNode, salt) {
    this.hdNode = ownerHdNode
    this.salt = salt
    this.appsNode = new AppsNode(ownerHdNode.deriveHardened(APPS_NODE_INDEX), salt)
  }

  getNode() {
    return this.hdNode
  }

  getSalt() {
    return this.salt
  }

  getIdentityKey() {
    return this.hdNode.privateKey.toString('hex')
  }

  getIdentityKeyID() {
    return this.hdNode.publicKey.toString('hex')
  }

  getAppsNode() {
    return this.appsNode
  }

  getSharedAppsPrivateKey() {
    return getSharedAppsPrivateKey(this.getAppsNode().hdNode).toString('hex')
  }

  getAddress() {
    return getAddressFromBIP32Node(this.hdNode)
  }

  getEncryptionNode() {
    return this.hdNode.deriveHardened(ENCRYPTION_NODE_INDEX)
  }

  getSigningNode() {
    return this.hdNode.deriveHardened(SIGNING_NODE_INDEX)
  }
}

export function isPasswordValid(password) {
  let isValid = false
  let error = null

  if (password.length >= 8) {
    isValid = true
    error = 'Password must be at least 8 characters'
  }

  return { isValid, error }
}

export function isBackupPhraseValid(backupPhrase) {
  let isValid = true
  let error = null
  return import(/* webpackChunkName: 'bip39' */ 'bip39').then(bip39 => {
    if (!bip39.validateMnemonic(backupPhrase)) {
      isValid = false
      error = 'Backup phrase is not a valid set of words'
    }

    return { isValid, error }
  })
}

export async function decryptMasterKeychain(password, encryptedBackupPhrase) {
  try {
    const dataBuffer = new Buffer(encryptedBackupPhrase, 'hex')
    const plaintextBuffer = await decrypt(dataBuffer, password)
    const bip39 = await import(/* webpackChunkName: 'bip39' */ 'bip39')
    const backupPhrase = plaintextBuffer.toString()
    const seed = await bip39.mnemonicToSeed(backupPhrase)
    const masterKeychain = bip32.fromSeed(seed)
    logger.info('decryptMasterKeychain: decrypted!')
    return masterKeychain
  } catch (error) {
    logger.error('decryptMasterKeychain: error', error)
    throw new Error('Incorrect password')
  }
}

const EXTERNAL_ADDRESS = 'EXTERNAL_ADDRESS'
const CHANGE_ADDRESS = 'CHANGE_ADDRESS'

export function getBitcoinPrivateKeychain(masterKeychain) {
  const BIP_44_PURPOSE = 44
  const BITCOIN_COIN_TYPE = 0
  const ACCOUNT_INDEX = 0

  return masterKeychain
    .deriveHardened(BIP_44_PURPOSE)
    .deriveHardened(BITCOIN_COIN_TYPE)
    .deriveHardened(ACCOUNT_INDEX)
}

export function getBitcoinPublicKeychain(masterKeychain) {
  return getBitcoinPrivateKeychain(masterKeychain).neutered()
}

/**
 * @param {bip32.BIP32} bitcoinKeychain 
 */
export function getBitcoinAddressNode(
  bitcoinKeychain,
  addressIndex = 0,
  chainType = EXTERNAL_ADDRESS
) {
  let chain = null

  if (chainType === EXTERNAL_ADDRESS) {
    chain = 0
  } else if (chainType === CHANGE_ADDRESS) {
    chain = 1
  } else {
    throw new Error('Invalid chain type')
  }

  return bitcoinKeychain.derive(chain).derive(addressIndex)
}

export function decryptBitcoinPrivateKey(password, encryptedBackupPhrase) {
  return new Promise((resolve, reject) =>
    decryptMasterKeychain(password, encryptedBackupPhrase)
      .then(masterKeychain => {
        const bitcoinPrivateKeychain = getBitcoinPrivateKeychain(masterKeychain)
        const bitcoinAddressHDNode = getBitcoinAddressNode(
          bitcoinPrivateKeychain,
          0
        )
        const privateKey = bitcoinAddressHDNode.keyPair.d
          .toBuffer(32)
          .toString('hex')
        resolve(privateKey)
      })
      .catch(error => {
        reject(error)
      })
  )
}

const IDENTITY_KEYCHAIN = 888
const BLOCKSTACK_ON_BITCOIN = 0

/**
 * @param {bip32.BIP32} masterKeychain 
 */
export function getIdentityPrivateKeychain(masterKeychain) {
  return masterKeychain
    .deriveHardened(IDENTITY_KEYCHAIN)
    .deriveHardened(BLOCKSTACK_ON_BITCOIN)
}

/**
 * @param {bip32.BIP32} masterKeychain 
 */
export function getIdentityPublicKeychain(masterKeychain) {
  return getIdentityPrivateKeychain(masterKeychain).neutered()
}

/**
 * @param {bip32.BIP32} identityPrivateKeychain 
 */
export function getIdentityOwnerAddressNode(
  identityPrivateKeychain,
  identityIndex = 0
) {
  if (identityPrivateKeychain.isNeutered()) {
    throw new Error('You need the private key to generate identity addresses')
  }

  const publicKeyHex = identityPrivateKeychain.publicKey.toString('hex')
  const salt = crypto
    .createHash('sha256')
    .update(publicKeyHex)
    .digest('hex')

  return new IdentityAddressOwnerNode(
    identityPrivateKeychain.deriveHardened(identityIndex),
    salt
  )
}

/**
 * @param {IdentityAddressOwnerNode} identityOwnerAddressNode 
 */
export function deriveIdentityKeyPair(identityOwnerAddressNode) {
  const address = identityOwnerAddressNode.getAddress()
  const identityKey = identityOwnerAddressNode.getIdentityKey()
  const identityKeyID = identityOwnerAddressNode.getIdentityKeyID()
  const appsNode = identityOwnerAddressNode.getAppsNode()
  const sharedAppsKey = identityOwnerAddressNode.getSharedAppsPrivateKey()
  const keyPair = {
    key: identityKey,
    keyID: identityKeyID,
    address,
    sharedAppsKey,
    appsNodeKey: appsNode.toBase58(),
    salt: appsNode.getSalt()
  }
  return keyPair
}

export function getWebAccountTypes(api) {
  const webAccountTypes = {
    twitter: {
      label: 'Twitter',
      iconClass: 'fa-twitter',
      social: true,
      urlTemplate: 'https://twitter.com/{identifier}'
    },
    facebook: {
      label: 'Facebook',
      iconClass: 'fa-facebook',
      social: true,
      urlTemplate: 'https://facebook.com/{identifier}'
    },
    github: {
      label: 'GitHub',
      iconClass: 'fa-github-alt',
      social: true,
      urlTemplate: 'https://github.com/{identifier}'
    },
    instagram: {
      label: 'Instagram',
      iconClass: 'fa-instagram',
      social: true,
      urlTemplate: 'https://instagram.com/{identifier}'
    },
    linkedIn: {
      label: 'LinkedIn',
      iconClass: 'fa-linkedin',
      social: true,
      urlTemplate: 'https://www.linkedin.com/in/{identifier}'
    },
    tumblr: {
      label: 'Tumblr',
      iconClass: 'fa-tumblr',
      social: true,
      urlTemplate: 'http://{identifier}.tumblr.com'
    },
    reddit: {
      label: 'Reddit',
      iconClass: 'fa-reddit-alien',
      social: true,
      urlTemplate: 'https://www.reddit.com/user/{identifier}'
    },
    pinterest: {
      label: 'Pinterest',
      iconClass: 'fa-pinterest',
      social: true,
      urlTemplate: 'https://pinterest.com/{identifier}'
    },
    youtube: {
      label: 'YouTube',
      iconClass: 'fa-youtube',
      social: true,
      urlTemplate: 'https://www.youtube.com/channel/{identifier}'
    },
    'google-plus': {
      label: 'Google+',
      iconClass: 'fa-google-plus',
      social: true,
      urlTemplate: 'https://plus.google.com/u/{identifier}'
    },
    angellist: {
      label: 'AngelList',
      iconClass: 'fa-angellist',
      social: true,
      urlTemplate: 'https://angel.co/{identifier}'
    },
    'stack-overflow': {
      label: 'StackOverflow',
      iconClass: 'fa-stack-overflow',
      social: true,
      urlTemplate: 'http://stackoverflow.com/users/{identifier}'
    },
    hackerNews: {
      label: 'Hacker News',
      iconClass: 'fa-hacker-news',
      social: true,
      urlTemplate: 'https://news.ycombinator.com/user?id={identifier}'
    },
    openbazaar: {
      label: 'OpenBazaar',
      iconClass: 'fa-shopping-cart',
      social: true,
      urlTemplate: 'ob://{identifier}'
    },
    snapchat: {
      label: 'Snapchat',
      iconClass: 'fa-snapchat-ghost',
      social: true,
      urlTemplate: 'https://snapchat.com/add/{identifier}'
    },
    website: {
      label: 'Website',
      iconClass: 'fa-link',
      social: false,
      urlTemplate: '{identifier}'
    },
    ssh: {
      label: 'SSH',
      iconClass: 'fa-key',
      social: false
    },
    pgp: {
      label: 'PGP',
      iconClass: 'fa-key',
      social: false
    },
    bitcoin: {
      label: 'Bitcoin',
      iconClass: 'fa-bitcoin',
      social: false,
      urlTemplate: api.bitcoinAddressUrl
    },
    ethereum: {
      label: 'Ethereum',
      iconClass: 'fa-key',
      social: false,
      urlTemplate: api.ethereumAddressUrl
    }
  }
  return webAccountTypes
}

export function calculateTrustLevel(verifications) {
  if (!verifications || verifications.length < 1) {
    return 0
  }

  let trustLevel = 0
  verifications.forEach(verification => {
    if (verification.valid && trustLevel < MAX_TRUST_LEVEL) {
      trustLevel++
    }
  })

  return trustLevel
}

export function calculateProfileCompleteness(profile, verifications) {
  let complete = 0
  const totalItems = 2
  const maxVerificationItems = 1

  if (profile.name && profile.name.length > 0) {
    complete++
  }

  // if (profile.description && profile.description.length > 0) {
  //   complete++
  // }

  // if (profile.image && profile.image.length > 0) {
  //   complete++
  // }

  complete += Math.min(calculateTrustLevel(verifications), maxVerificationItems)

  return complete / totalItems
}

export function findAddressIndex(address, identityAddresses) {
  for (let i = 0; i < identityAddresses.length; i++) {
    if (identityAddresses[i] === address) {
      return i
    }
  }
  return null
}

export function getBlockchainIdentities(masterKeychain, identitiesToGenerate) {
  const identityPrivateKeychainNode = getIdentityPrivateKeychain(masterKeychain)
  const bitcoinPrivateKeychainNode = getBitcoinPrivateKeychain(masterKeychain)

  const identityPublicKeychainNode = identityPrivateKeychainNode.neutered()
  const identityPublicKeychain = identityPublicKeychainNode.toBase58()

  const bitcoinPublicKeychainNode = bitcoinPrivateKeychainNode.neutered()
  const bitcoinPublicKeychain = bitcoinPublicKeychainNode.toBase58()

  const firstBitcoinAddress = getAddressFromBIP32Node(getBitcoinAddressNode(
    bitcoinPublicKeychainNode
  ))

  const identityAddresses = []
  const identityKeypairs = []

  // We pre-generate a number of identity addresses so that we
  // don't have to prompt the user for the password on each new profile
  for (
    let addressIndex = 0;
    addressIndex < identitiesToGenerate;
    addressIndex++
  ) {
    const identityOwnerAddressNode = getIdentityOwnerAddressNode(
      identityPrivateKeychainNode,
      addressIndex
    )
    const identityKeyPair = deriveIdentityKeyPair(identityOwnerAddressNode)
    identityKeypairs.push(identityKeyPair)
    identityAddresses.push(identityKeyPair.address)
    logger.debug(`createAccount: identity index: ${addressIndex}`)
  }

  return {
    identityPublicKeychain,
    bitcoinPublicKeychain,
    firstBitcoinAddress,
    identityAddresses,
    identityKeypairs
  }
}
