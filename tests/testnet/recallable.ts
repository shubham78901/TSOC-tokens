import { bsv, findSig, MethodCallOptions, PubKey, toHex } from 'scrypt-ts'
import { Recallable } from '../../src/contracts/recallable'
import { getDefaultSigner, randomPrivateKey } from '../utils/helper'
import { myPublicKey } from '../utils/privateKey'
import Transaction = bsv.Transaction

// 3 players, alice, bob, and me
// I am the issuer
const [alicePrivateKey, alicePublicKey, ,] = randomPrivateKey()
const [, bobPublicKey, ,] = randomPrivateKey()

// contract deploy transaction
let deployTx: string
// last contract calling transaction
let lastCallTx: string
let lastCallTx1: string
// contract output index
const atOutputIndex = 0

const satoshisIssued = 10
const satoshisSendToAlice = 7
const satoshisSendToBob = 7

async function deploy() {
    await Recallable.compile()

    // I am the issuer, and the first user as well
    const initialInstance = new Recallable(PubKey(toHex(myPublicKey)))

    // there is one key in the signer, that is `myPrivateKey` (added by default)
    await initialInstance.connect(getDefaultSigner())

    // I issue 10 re-callable satoshis
    const deployTxObj = await initialInstance.deploy(satoshisIssued)
    console.log(`I issue ${satoshisIssued}: ${deployTxObj.id}`)

    // the current balance of each player:
    // - me     10 (1 utxo)
    // - alice  0
    // - bob    0
    deployTx = deployTxObj.id
}

async function recoverAfterDeployed() {
    // recover instance from contract deploy transaction

    const signer = getDefaultSigner()
    const tx = await signer.connectedProvider.getTransaction(deployTx)

    const meInstance = Recallable.fromTx(tx, atOutputIndex)
    meInstance.connect(signer)
    const meRecallInstance = meInstance.next()

    // connect a signer
    await meInstance.connect(getDefaultSigner())

    // now `meInstance` is good to use
    console.log('Contract `Recallable` recovered after deployed')

    // I send 7 to alice, keep 3 left
    const meNextInstance = meInstance.next()

    const aliceNextInstance = meInstance.next()
    aliceNextInstance.userPubKey = PubKey(toHex(alicePublicKey))

    const { tx: transferToAliceTx } = await meInstance.methods.transfer(
        (sigResps) => findSig(sigResps, myPublicKey),
        PubKey(toHex(alicePublicKey)),
        BigInt(satoshisSendToAlice),
        {
            // sign with the private key corresponding to `myPublicKey` (which is `myPrivateKey` in the signer)
            // since I am the current user
            pubKeyOrAddrToSign: myPublicKey,
            next: [
                {
                    // outputIndex 0: UTXO of alice
                    instance: aliceNextInstance,
                    balance: satoshisSendToAlice,
                },
                {
                    // outputIndex 1: the change UTXO back to me
                    instance: meNextInstance,
                    balance: satoshisIssued - satoshisSendToAlice,
                },
            ],
        } as MethodCallOptions<Recallable>
    )
    console.log(
        `I send ${satoshisSendToAlice} to Alice: ${transferToAliceTx.id}`
    )
    lastCallTx = transferToAliceTx.id

    // the current balance of each player:
    // - me     3 (1 utxo)
    // - alice  7 (1 utxo)
    // - bob    0
}

async function recoverAfterCalled() {
    const signer = getDefaultSigner()
    // recover instance from contract calling transaction
    const tx = await signer.connectedProvider.getTransaction(lastCallTx)

    const aliceInstance = Recallable.fromTx(tx, atOutputIndex)

    // connect a signer
    await aliceInstance.connect(getDefaultSigner(alicePrivateKey))

    // now `aliceInstance` is good to use
    console.log('Contract `Recallable` recovered after calling')

    // alice sends all the 7 to bob, keeps nothing left
    const bobNextInstance = aliceInstance.next()
    bobNextInstance.userPubKey = PubKey(toHex(bobPublicKey))

    const { tx: transferToBobTx } = await aliceInstance.methods.transfer(
        (sigResps) => findSig(sigResps, alicePublicKey),
        PubKey(toHex(bobPublicKey)),
        BigInt(satoshisSendToBob),
        {
            // sign with the private key corresponding to `alicePublicKey` (which is `alicePrivateKey` in the signer)
            // since she is the current user
            pubKeyOrAddrToSign: alicePublicKey,
            next: {
                instance: bobNextInstance,
                balance: satoshisSendToBob,
                atOutputIndex: 0,
            },
        } as MethodCallOptions<Recallable>
    )
    console.log(
        `Alice sends ${satoshisSendToBob} to Bob: ${transferToBobTx.id}`
    )

    lastCallTx1 = transferToBobTx.id
}
async function recall() {
    const signer = getDefaultSigner()
    const tx = await signer.connectedProvider.getTransaction(lastCallTx1)

    const instance = Recallable.fromTx(tx, atOutputIndex)
    instance.connect(signer)
    const meRecallInstance = instance.next()
    meRecallInstance.userPubKey = PubKey(toHex(myPublicKey))

    const { tx: recallTx } = await instance.methods.recall(
        (sigResps) => findSig(sigResps, myPublicKey),
        {
            // sign with the private key corresponding to `myPublicKey` (which is `myPrivateKey` in the signer)
            // since I am the issuer at the beginning
            pubKeyOrAddrToSign: myPublicKey,
            next: {
                instance: meRecallInstance,
                balance: satoshisSendToBob,
                atOutputIndex: 0,
            },
        } as MethodCallOptions<Recallable>
    )
    console.log(`I recall ${satoshisSendToBob} from Bob: ${recallTx.id}`)

    // the current balance of each player:
    // - me     10 (2 utxos)
    // - alice  0
    // - bob    0
}

describe('Test SmartContract `Recallable` on testnet', () => {
    it('should succeed', async () => {
        await deploy()
        await recoverAfterDeployed()
        await recoverAfterCalled()
        await recall()
    })
})
