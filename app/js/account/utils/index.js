// @flow
import { parseZoneFile } from 'zone-file'

import type { GaiaHubConfig } from 'blockstack'
import { connectToGaiaHub, uploadToGaiaHub } from 'blockstack'

import { getTokenFileUrlFromZoneFile } from '@utils/zone-utils'

export const BLOCKSTACK_INC = 'gaia-hub'

function getProfileUploadLocation(identity: any, hubConfig: GaiaHubConfig) {
  if (identity.zoneFile) {
    const zoneFileJson = parseZoneFile(identity.zoneFile)
    return getTokenFileUrlFromZoneFile(zoneFileJson)
  } else {
    // aaron-debt: this should call a function in blockstack.js to get
    //   the read url
    return `${hubConfig.url_prefix}${hubConfig.address}/profile.json`
  }
}

// aaron-debt: this should be moved into blockstack.js
function canWriteUrl(url: string, hubConfig: GaiaHubConfig): ?string {
  const readPrefix = `${hubConfig.url_prefix}${hubConfig.address}/`
  if (url.startsWith(readPrefix)) {
    return url.substring(readPrefix.length)
  } else {
    return null
  }
}

function tryUpload(
  urlToWrite: string,
  data: string,
  hubConfig: GaiaHubConfig,
  mimeType: ?string = undefined
) {
  const filenameWrite = canWriteUrl(urlToWrite, hubConfig)
  if (filenameWrite === null) {
    return null
  }
  return uploadToGaiaHub(filenameWrite, data, hubConfig, mimeType)
}

export function uploadPhoto(
  api: { gaiaHubConfig: GaiaHubConfig, gaiaHubUrl: string },
  identity: any,
  identityKeyPair: { key: string },
  photoFile: string,
  photoIndex: number
) {
  return connectToGaiaHub(api.gaiaHubUrl, identityKeyPair.key).then(identityHubConfig => {
    const globalHubConfig = api.gaiaHubConfig

    let uploadPrefix = getProfileUploadLocation(identity, identityHubConfig)
    if (uploadPrefix.endsWith('profile.json')) {
      uploadPrefix = uploadPrefix.substring(0, uploadPrefix.length - 'profile.json'.length)
    } else {
      throw new Error(`Cannot determine photo location based on profile location ${uploadPrefix}`)
    }
    const urlToWrite = `${uploadPrefix}/avatar-${photoIndex}`
    let uploadAttempt = tryUpload(urlToWrite, photoFile, identityHubConfig, undefined)
    if (uploadAttempt === null) {
      uploadAttempt = tryUpload(urlToWrite, photoFile, globalHubConfig, undefined)
    }

    // if still null, we don't know the write gaia-hub-config to write the file.
    if (uploadAttempt === null) {
      throw new Error(`Wanted to write to ${urlToWrite} but I don't know how.`)
    }

    return uploadAttempt
  })
}

export function uploadProfile(
  api: { gaiaHubConfig: GaiaHubConfig, gaiaHubUrl: string },
  identity: any,
  identityKeyPair: { key: string },
  signedProfileTokenData: string
) {
  return connectToGaiaHub(api.gaiaHubUrl, identityKeyPair.key).then(identityHubConfig => {
    const globalHubConfig = api.gaiaHubConfig

    const urlToWrite = getProfileUploadLocation(identity, identityHubConfig)

    let uploadAttempt = tryUpload(
      urlToWrite,
      signedProfileTokenData,
      identityHubConfig,
      'application/json'
    )
    if (uploadAttempt === null) {
      uploadAttempt = tryUpload(
        urlToWrite,
        signedProfileTokenData,
        globalHubConfig,
        'application/json'
      )
    }

    // if still null, we don't know the write gaia-hub-config to write the file.
    if (uploadAttempt === null) {
      throw new Error(`Wanted to write to ${urlToWrite} but I don't know how.`)
    }

    return uploadAttempt
  })
}
