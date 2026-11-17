<script lang="ts">
  let {
    running,
    done,
    onBreak = false,
    locked,
    lockedBy,
    onpause,
    onresume,
    onskip,
    onleave,
    onrestart,
  }: {
    running: boolean;
    done: boolean;
    onBreak?: boolean;
    locked: boolean;
    lockedBy?: string;
    onpause: () => void;
    onresume: () => void;
    onskip: () => void;
    onleave: () => void;
    onrestart: () => void;
  } = $props();

  let confirming = $state(false);
  let leaveButton = $state<HTMLButtonElement>();
  let stayButton = $state<HTMLButtonElement>();

  const leaveLabel = $derived(locked ? 'Stop following' : 'Leave');

  function ask() {
    confirming = true;
  }

  function stay() {
    confirming = false;
  }

  // Move focus with the swap so keyboard users are not dropped on the page.
  $effect(() => {
    if (confirming) stayButton?.focus();
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && confirming) {
      confirming = false;
      leaveButton?.focus();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="controls">
  {#if locked && !done}
    <p class="following">Following {lockedBy ?? 'someone'}'s timer</p>
  {/if}

  {#if done}
    <div class="row">
      {#if !locked}
        <button type="button" class="btn primary" onclick={onrestart}>Same again</button>
      {/if}
      <button type="button" class="btn" class:primary={locked} onclick={onleave}>
        {locked ? 'Back to my own timer' : 'Another round'}
      </button>
    </div>
  {:else if confirming}
    <div class="row confirm">
      <p class="ask">{locked ? 'Stop following?' : 'Leave this timer?'}</p>
      <button type="button" class="btn" onclick={onleave}>{leaveLabel}</button>
      <button type="button" class="btn" bind:this={stayButton} onclick={stay}>Stay</button>
    </div>
  {:else}
    <div class="row">
      <button
        type="button"
        class="btn primary"
        disabled={locked}
        onclick={running ? onpause : onresume}
      >
        {running ? 'Pause' : 'Resume'}
      </button>
      {#if onBreak && !locked}
        <button type="button" class="btn" onclick={onskip}>Skip break</button>
      {/if}
      <button type="button" class="btn" bind:this={leaveButton} onclick={ask}>{leaveLabel}</button>
    </div>
  {/if}
</div>

<style>
  .controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s2);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: var(--s2);
  }

  .following,
  .ask {
    margin: 0;
    font-size: var(--t2);
    color: var(--white);
    -webkit-text-stroke: var(--px) var(--ink);
    paint-order: stroke fill;
    text-shadow: calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--ink);
  }

  .btn {
    min-width: 132px;
    min-height: 48px;
    line-height: 1;
  }
</style>
