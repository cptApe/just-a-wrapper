// Client reducers that stop double submits and stop a late reply from overwriting newer state.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profileUploadReducer } from '../../src/features/files/lib/profile-upload-machine.ts';
import { overlayRetentionReducer } from '../../src/features/overlays/lib/overlay-retention-machine.ts';
import { invitationResponseReducer } from '../../src/features/workspaces/lib/invitation-response-machine.ts';
import { inviteMembersReducer } from '../../src/features/workspaces/lib/invite-members-machine.ts';
import { memberMutationReducer } from '../../src/features/workspaces/lib/member-mutation-machine.ts';
import { asyncActionReducer } from '../../src/lib/async-action-machine.ts';

test('an action in flight refuses a second start and ignores a stale finish', () => {
  const attempt = Symbol();
  const state = asyncActionReducer({ kind: 'idle' }, { type: 'start', attempt });
  assert.equal(asyncActionReducer(state, { type: 'start', attempt: Symbol() }), state);
  assert.equal(asyncActionReducer(state, { type: 'finish', attempt: Symbol() }), state);
  assert.deepEqual(asyncActionReducer(state, { type: 'finish', attempt }), { kind: 'idle' });
});

test('a profile photo being saved cannot be closed, replaced or moved by a stale upload', () => {
  const attempt = Symbol();
  const file = new File(['image'], 'avatar.png');
  const ready = profileUploadReducer(
    { kind: 'idle' },
    { type: 'select', file, previewUrl: 'blob:image' },
  );
  const uploading = profileUploadReducer(ready, { type: 'start', attempt });
  for (const event of [
    { type: 'reset' },
    { type: 'select', file, previewUrl: 'blob:other' },
    { type: 'progress', progress: 1, attempt: Symbol() },
  ])
    assert.equal(profileUploadReducer(uploading, event), uploading);
  assert.equal(profileUploadReducer(uploading, { type: 'failed', attempt }).kind, 'ready');
  assert.equal(profileUploadReducer(uploading, { type: 'saved', attempt }).kind, 'success');
});

test('an invitation answer is final and a late reply cannot change it', () => {
  const attempt = Symbol();
  const pending = invitationResponseReducer(
    { kind: 'idle' },
    { type: 'submit', decision: 'accepted', attempt },
  );
  assert.equal(invitationResponseReducer(pending, { type: 'success', attempt: Symbol() }), pending);
  const accepted = invitationResponseReducer(pending, { type: 'success', attempt });
  assert.equal(accepted.kind, 'accepted');
  assert.equal(
    invitationResponseReducer(accepted, { type: 'submit', decision: 'rejected', attempt }),
    accepted,
  );
});

test('one member change at a time, finished only by its own reply', () => {
  const attempt = Symbol();
  const pending = memberMutationReducer(
    { kind: 'idle' },
    { type: 'start', memberId: 'owner', attempt },
  );
  assert.equal(
    memberMutationReducer(pending, { type: 'start', memberId: 'other', attempt: Symbol() }),
    pending,
  );
  assert.equal(memberMutationReducer(pending, { type: 'finish', attempt: Symbol() }), pending);
  assert.equal(memberMutationReducer(pending, { type: 'finish', attempt }).kind, 'idle');
});

test('a retried invitation batch resends only to the people who failed', () => {
  const attempt = Symbol();
  const initial = {
    kind: 'editing',
    raw: 'a@example.com b@example.com',
    role: 'member',
    results: [],
    error: null,
  };
  const sending = inviteMembersReducer(initial, { type: 'send', attempt });
  assert.equal(inviteMembersReducer(sending, { type: 'raw', raw: 'x' }), sending);
  const finished = inviteMembersReducer(sending, {
    type: 'finish',
    attempt,
    results: [
      { email: 'a@example.com', ok: true, data: { emailSent: true } },
      { email: 'b@example.com', ok: false, code: 'UNEXPECTED', message: 'Failed' },
    ],
  });
  assert.equal(finished.raw, 'b@example.com');
});

test('the exit timer of a closed overlay cannot remove a newly opened one', () => {
  const old = { token: 'file', id: 'old' };
  const next = { token: 'file', id: 'new' };
  const closing = overlayRetentionReducer({ kind: 'open', value: old }, { type: 'close' });
  const reopened = overlayRetentionReducer(closing, { type: 'open', value: next });
  assert.equal(overlayRetentionReducer(reopened, { type: 'release', value: old }), reopened);
  assert.equal(overlayRetentionReducer(closing, { type: 'release', value: old }).kind, 'closed');
});
