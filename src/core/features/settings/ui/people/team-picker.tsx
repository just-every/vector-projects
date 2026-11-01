type Team = { id: string; name: string };

/** Which teams a Guest works in, or which private teams a Viewer may also read. Assignment and invitation share it. */
export function TeamPicker({ role, teams, selected, onChange, disabled = false }: {
  role: 'guest' | 'viewer'; teams: Team[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  return <fieldset className="team-picker" disabled={disabled}>
    <legend>Teams this {role === 'guest' ? 'Guest' : 'Viewer'} can access</legend>
    <p className="field-hint">{role === 'guest'
      ? 'Choose at least one team. The Guest sees issues and projects contributed by these teams.'
      : 'The Viewer reads every public team. Choose the private teams they may also read.'}</p>
    {teams.map(team => <label key={team.id}>
      <input type="checkbox" name="teamIds" value={team.id} checked={selected.includes(team.id)}
        onChange={event => onChange(event.target.checked ? [...selected, team.id] : selected.filter(id => id !== team.id))} />
      <span>{team.name}</span>
    </label>)}
  </fieldset>;
}
