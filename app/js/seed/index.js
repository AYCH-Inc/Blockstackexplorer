import React, { Component } from 'react'
import PropTypes from 'prop-types'
import { SeedInfo, SeedDecrypt, Seed, SeedConfirm, SeedComplete } from './views'
import PanelShell, { renderItems } from '@components/PanelShell'
import { decrypt } from '@utils/encryption-utils'
import { browserHistory, withRouter } from 'react-router'
import { connect } from 'react-redux'
import { bindActionCreators } from 'redux'
import { AccountActions } from '../account/store/account'
import { IdentityActions } from '../profiles/store/identity'

function mapStateToProps(state) {
  return {
    encryptedBackupPhrase: state.account.encryptedBackupPhrase,
  }
}

function mapDispatchToProps(dispatch) {
  return bindActionCreators(Object.assign({},
    AccountActions, IdentityActions),
    dispatch)
}

const VIEWS = {
  KEY_INFO: 0,
  UNLOCK_KEY: 1,
  KEY_1: 2,
  KEY_2: 3,
  KEY_3: 4,
  KEY_CONFIRM: 5,
  KEY_COMPLETE: 6,
  RECOVERY_OPTIONS: 7
}

const splitSeed = seed => {
  // to-do: make this function smarter
  const x = seed ? seed.split(' ') : []
  return {
    first: [x[0], x[1], x[2], x[3]],
    second: [x[4], x[5], x[6], x[7]],
    third: [x[8], x[9], x[10], x[11]]
  }
}

class SeedContainer extends Component {
  state = {
    encryptedSeed: null,
    seed: null,
    view: 0
  }

  componentWillMount() {
    const { location } = this.props
    const cached = this.getCachedEncryptedSeed()
    if (location && location.query && location.query.encrypted) {
      if (this.state.encryptedSeed !== location.query.encrypted) {
        this.setState({ encryptedSeed: location.query.encrypted })
      }
    } else if (location && location.state && location.state.seed) {
      if (this.state.seed !== location.state.seed) {
        this.setState({
          seed: location.state.seed
        })
      }
    } else if (cached) {
      if (this.state.encryptedSeed !== cached) {
        this.setState({ encryptedSeed: cached })
      }
    }
  }

  updateValue = (key, value) => {
    this.setState({ [key]: value })
  }

  updateView = view => {
    if (this.state.view !== view) {
      this.setState({ view })
    }
  }

  getCachedEncryptedSeed = () => {
    const cached = this.props.encryptedBackupPhrase
    return cached
    // console.log(cached)
    // const cached = localStorage.getItem('encryptedSeeds')

    // TO DO: this should check against the currently logged in username.
    // Right now, this logic simply picks the first seed in the object.
    // return cached ? JSON.parse(cached)[0].encryptedSeed : null
  }

  decryptSeed = password => {
    const buffer = new Buffer(this.state.encryptedSeed, 'hex')

    decrypt(buffer, password).then(result => {
      if (this.state.seed !== result.toString()) {
        this.setState({
          view: VIEWS.KEY_1,
          seed: result.toString()
        })
      }
    })
  }

  startBackup = () => {
    const nextView = this.state.seed ? VIEWS.KEY_1 : VIEWS.UNLOCK_KEY
    this.updateView(nextView)
  }

  render() {
    const { password, view, seed } = this.state
    const seedList = splitSeed(seed)

    const views = [
      {
        show: VIEWS.KEY_INFO,
        Component: SeedInfo,
        props: {
          next: () =>
            this.updateView(this.state.seed ? VIEWS.KEY_1 : VIEWS.UNLOCK_KEY)
        }
      },
      {
        show: VIEWS.UNLOCK_KEY,
        Component: SeedDecrypt,
        props: {
          previous: () => this.updateView(VIEWS.KEY_INFO),
          next: () => this.updateView(VIEWS.KEY_1),
          password,
          decryptSeed: p => this.decryptSeed(p)
        }
      },
      {
        show: VIEWS.KEY_1,
        Component: Seed,
        props: {
          previous: () => this.updateView(VIEWS.KEY_INFO),
          next: () => this.updateView(VIEWS.KEY_2),
          password,
          completeSeed: seed,
          seed: seedList.first,
          set: 1
        }
      },
      {
        show: VIEWS.KEY_2,
        Component: Seed,
        props: {
          previous: () => this.updateView(VIEWS.KEY_1),
          next: () => this.updateView(VIEWS.KEY_3),
          password,
          completeSeed: seed,
          seed: seedList.second,
          set: 2
        }
      },
      {
        show: VIEWS.KEY_3,
        Component: Seed,
        props: {
          previous: () => this.updateView(VIEWS.KEY_2),
          next: () => this.updateView(VIEWS.KEY_CONFIRM),
          password,
          completeSeed: seed,
          seed: seedList.third,
          set: 3
        }
      },
      {
        show: VIEWS.KEY_CONFIRM,
        Component: SeedConfirm,
        props: {
          previous: () => this.updateView(VIEWS.KEY_3),
          next: () => this.updateView(VIEWS.KEY_COMPLETE)
        }
      },
      { show: VIEWS.KEY_COMPLETE, Component: SeedComplete, props: null }
    ]
    return <PanelShell>{renderItems(views, view)}</PanelShell>
  }
}

SeedContainer.propTypes = {
  location: PropTypes.object.isRequired,
  encryptedBackupPhrase: PropTypes.string
}

export default withRouter(connect(mapStateToProps, mapDispatchToProps)(SeedContainer))
