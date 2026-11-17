<script lang="ts">
  let {
    checked,
    label,
    disabled = false,
    onchange,
    hint,
  }: {
    checked: boolean;
    label: string;
    disabled?: boolean;
    onchange: (checked: boolean) => void;
    hint?: string;
  } = $props();
</script>

<label class="toggle" class:disabled>
  <input type="checkbox" {checked} {disabled} onchange={(e) => onchange(e.currentTarget.checked)} />
  <span class="track" aria-hidden="true"><span class="knob"></span></span>
  <span class="text">
    <span class="label">{label}</span>
    {#if hint}<span class="hint">{hint}</span>{/if}
  </span>
</label>

<style>
  .toggle {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-height: 42px;
    cursor: pointer;
  }

  .toggle.disabled {
    cursor: not-allowed;
    color: var(--plum);
  }

  input {
    position: absolute;
    opacity: 0;
    width: 54px;
    height: 30px;
    margin: 0;
  }

  .track {
    position: relative;
    flex: none;
    width: 54px;
    height: 30px;
    background: var(--white);
    border: var(--border);
  }

  .knob {
    position: absolute;
    top: 0;
    left: 0;
    width: 24px;
    height: 24px;
    background: var(--ink);
  }

  input:checked + .track {
    background: var(--matcha);
  }

  input:checked + .track .knob {
    left: 24px;
  }

  input:disabled + .track {
    background: var(--foam);
  }

  input:disabled:checked + .track {
    background: var(--moss);
  }

  input:focus-visible + .track {
    outline: var(--px) solid var(--butter);
    outline-offset: var(--px);
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .hint {
    color: var(--plum);
  }
</style>
