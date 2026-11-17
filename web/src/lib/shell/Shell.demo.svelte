<script lang="ts">
  import Background from '../backgrounds/Background.svelte';
  import { backgrounds } from '../backgrounds/backgrounds.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import TopBar from './TopBar.svelte';

  const params = new URLSearchParams(location.search);
  let open = $state(params.has('open'));
  const locked = params.has('locked');
</script>

<Background id={backgrounds.selectedId} />
<TopBar onsettings={() => (open = true)} />
<SettingsPanel bind:open {locked} lockedBy="Mocha Otter" />
