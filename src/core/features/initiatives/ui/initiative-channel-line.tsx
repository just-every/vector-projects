import '../../documents/ui/documents.css';
import {useEffect} from 'react';
import {Link} from '@tanstack/react-router';
import {useApiResource} from '../../../app/api-client';
import {channelConfiguration,channelEventLabels,notPostingMessage} from '../../integrations/channels/schema';
/** Where this initiative posts, from the channel read only Owners and Admins may make. */
export function InitiativeChannelLine({id,revision}:{id:string;revision:number}){
 const config=useApiResource('/api/settings/integrations/channels',channelConfiguration);
 const refresh=config.refreshAfterMutation;
 useEffect(()=>{if(revision)refresh();},[revision,refresh]);
 if(config.error)return <p role="alert">{config.error.message}</p>;
 if(!config.data)return null;
 const binding=config.data.bindings.find(binding=>binding.scope==='initiative'&&binding.objectId===id);
 return <p>{binding?<>{binding.notPosting||binding.needsAttention||binding.suspendedReason?'Not posting to':'Posts to'} {binding.provider==='slack'?'Slack':'Discord'} #{binding.channelName} · {binding.notPosting?notPostingMessage(binding.notPosting,binding.channelName,true):binding.suspendedReason?'Routing suspended. Save the binding again in Settings.':binding.needsAttention?'Re-enter the channel credentials in Settings.':binding.events.map(event=>channelEventLabels[event]).join(', ')}</>:'Not posted to a channel'} · <Link className="document-team-link" to="/app/settings/connections">{binding?'Change':'Set up'}</Link></p>;
}
