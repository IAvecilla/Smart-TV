import {useCallback, useEffect, useState, memo} from 'react';
import {Row, Column} from '@enact/ui/Layout';
import {Panel, Header} from '@enact/sandstone/Panels';
import Spinner from '@enact/sandstone/Spinner';
import BodyText from '@enact/sandstone/BodyText';
import Button from '@enact/sandstone/Button';
import Image from '@enact/sandstone/Image';
import TabLayout, {Tab} from '@enact/sandstone/TabLayout';
import VirtualList from '@enact/sandstone/VirtualList';
import ri from '@enact/ui/resolution';
import Spotlight from '@enact/spotlight';
import Spottable from '@enact/spotlight/Spottable';
import $L from '@enact/i18n/$L';
import jellyseerrApi from '../../services/jellyseerrApi';
import hydrateRequestMediaItems from '../../utils/jellyseerrHydration';
import {useJellyseerr} from '../../context/JellyseerrContext';
import {useSettings} from '../../context/SettingsContext';
import css from './JellyseerrRequests.module.less';

const SpottableRow = Spottable('div');

const getStatusInfo = (request) => {
	const mediaStatus = request.media?.status;
	if (request.status === 1) return {label: $L('Pending'), variant: css.chipPending};
	if (request.status === 3) return {label: $L('Declined'), variant: css.chipDeclined};
	if (mediaStatus === 5) return {label: $L('Available'), variant: css.chipAvailable};
	if (mediaStatus === 4) return {label: $L('Partially Available'), variant: css.chipPartial};
	if (mediaStatus === 3) return {label: $L('Downloading'), variant: css.chipDownloading};
	if (request.status === 2) return {label: $L('Approved'), variant: css.chipApproved};
	return {label: $L('Unknown'), variant: css.chipPending};
};

const getDownloadProgress = (request) => {
	const is4k = request.is4k;
	const items = is4k
		? (request.media?.downloadStatus4k || [])
		: (request.media?.downloadStatus || []);
	if (!items || items.length === 0) return null;

	const totalSize = items.reduce((sum, item) => sum + (item.size || 0), 0);
	const totalLeft = items.reduce((sum, item) => sum + (item.sizeLeft || 0), 0);
	const percent = totalSize > 0 ? Math.round(((totalSize - totalLeft) / totalSize) * 100) : 0;

	const itemWithEpisode = items.find(item => item.episode);
	const earliestEta = items
		.map(i => i.estimatedCompletionTime ? new Date(i.estimatedCompletionTime).getTime() : null)
		.filter(Boolean);
	const eta = earliestEta.length > 0 ? new Date(Math.min(...earliestEta)) : null;

	return {
		percent: Math.max(0, Math.min(100, percent)),
		status: items[0]?.status || '',
		count: items.length,
		episode: itemWithEpisode?.episode || null,
		eta
	};
};

const formatEta = (date) => {
	if (!date) return null;
	const now = Date.now();
	const diff = date.getTime() - now;
	if (diff <= 0) return $L('Finishing...');
	const mins = Math.ceil(diff / 60000);
	if (mins < 60) return `${mins}m`;
	const hours = Math.ceil(mins / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.ceil(hours / 24);
	return `${days}d`;
};

// Memoized request item component to avoid arrow functions in JSX props
const RequestItem = memo(function RequestItem({request, index, onSelect, onCancel}) {
	const media = request.media;
	const posterUrl = media?.posterPath
		? jellyseerrApi.getImageUrl(media.posterPath, 'w185')
		: null;
	const {label: statusLabel, variant: statusVariant} = getStatusInfo(request);
	const dl = getDownloadProgress(request);

	const handleClick = useCallback(() => {
		onSelect(request);
	}, [request, onSelect]);

	const handleCancelClick = useCallback((e) => {
		onCancel(request.id, e);
	}, [request.id, onCancel]);

	const episodeLabel = dl?.episode
		? `S${dl.episode.seasonNumber}E${dl.episode.episodeNumber}`
		: null;
	const etaLabel = dl?.eta ? formatEta(dl.eta) : null;

	return (
		<SpottableRow
			className={css.requestItem}
			data-spotlight-id={`request-${index}`}
			onClick={handleClick}
		>
			{posterUrl && (
				<Image src={posterUrl} className={css.poster} sizing="fill" />
			)}
			<Column className={css.requestInfo}>
				<BodyText className={css.title}>
					{media?.title || media?.name || $L('Unknown')}
				</BodyText>
				<Row className={css.meta}>
					<span className={css.type}>
						{media?.mediaType === 'movie' ? $L('Movie') : $L('TV Show')}
					</span>
					<span className={`${css.statusChip} ${statusVariant}`}>
						{statusLabel}
					</span>
				</Row>
				{dl && (
					<Column className={css.downloadProgress}>
						<div className={css.progressBarTrack}>
							<div
								className={css.progressBarFill}
								style={{width: `${dl.percent}%`}}
							/>
							<span className={css.progressBarText}>{dl.percent}%</span>
						</div>
						<Row className={css.downloadMeta}>
							{episodeLabel && (
								<span className={css.episodeTag}>{episodeLabel}</span>
							)}
							<span className={css.downloadStatus}>{dl.status}</span>
							{etaLabel && (
								<span className={css.etaTag}>~{etaLabel}</span>
							)}
						</Row>
					</Column>
				)}
				<BodyText className={css.date}>
					{$L('Requested:')} {new Date(request.createdAt).toLocaleDateString()}
				</BodyText>
			</Column>
			{request.status === 1 && (
				<Button
					className={css.cancelBtn}
					size="small"
					icon="trash"
					onClick={handleCancelClick}
				>
					{$L('Cancel')}
				</Button>
			)}
		</SpottableRow>
	);
});

const JellyseerrRequests = ({onSelectItem, onClose, ...rest}) => {
	const {isAuthenticated} = useJellyseerr();
	const {settings} = useSettings();
	const [requests, setRequests] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [filter, setFilter] = useState('all');

	const loadRequests = useCallback(async () => {
		if (!isAuthenticated) return;

		setLoading(true);
		setError(null);
		try {
			const data = await jellyseerrApi.getRequests({take: 100});
			const hydrated = await hydrateRequestMediaItems(data.results || []);
			setRequests(hydrated);
		} catch (err) {
			console.error('Failed to load requests:', err);
			setError(err.message || $L('Failed to load requests'));
		} finally {
			setLoading(false);
		}
	}, [isAuthenticated]);

	useEffect(() => {
		loadRequests();
	}, [loadRequests]);

	useEffect(() => {
		if (!loading && requests.length > 0) {
			Spotlight.focus('[data-spotlight-id="request-0"]');
		}
	}, [loading, requests]);

	const handleSelect = useCallback((request) => {
		if (onSelectItem && request.media) {
			const mediaType = request.media.mediaType || request.media.media_type || request.type;
			onSelectItem({
				mediaType,
				mediaId: request.media.tmdbId || request.media.id
			});
		}
	}, [onSelectItem]);

	const handleCancel = useCallback(async (requestId, e) => {
		e.stopPropagation();
		try {
			await jellyseerrApi.cancelRequest(requestId);
			await loadRequests();
		} catch (err) {
			console.error('Failed to cancel request:', err);
		}
	}, [loadRequests]);

	const handleTabSelect = useCallback(({index}) => {
		const filters = ['all', 'pending', 'approved', 'available'];
		setFilter(filters[index]);
	}, []);

	const filteredRequests = requests.filter(r => {
		if (filter === 'all') return true;
		if (filter === 'pending') return r.status === 1;
		if (filter === 'approved') return r.status === 2;
		if (filter === 'available') return r.media?.status === 5;
		return true;
	});

	const renderRequest = useCallback(({index}) => {
		const request = filteredRequests[index];
		if (!request) return null;

		return (
			<RequestItem
				key={request.id}
				request={request}
				index={index}
				onSelect={handleSelect}
				onCancel={handleCancel}
			/>
		);
	}, [filteredRequests, handleSelect, handleCancel]);

	const renderContent = () => {
		if (!isAuthenticated) {
			return (
				<Column align="center center" className={css.message}>
					<BodyText>{$L('Please configure Jellyseerr in Settings')}</BodyText>
				</Column>
			);
		}

		if (loading) {
			return <Spinner centered>{$L('Loading requests...')}</Spinner>;
		}

		if (error) {
			return (
				<Column align="center center" className={css.error}>
					<BodyText>{error}</BodyText>
					<Button onClick={loadRequests}>{$L('Retry')}</Button>
				</Column>
			);
		}

		if (filteredRequests.length === 0) {
			return (
				<Column align="center center" className={css.message}>
					<BodyText>{$L('No requests found')}</BodyText>
				</Column>
			);
		}

		return (
			<VirtualList
				dataSize={filteredRequests.length}
				itemRenderer={renderRequest}
				itemSize={ri.scale(155 * (settings.uiScale || 1.0))}
				direction="vertical"
				spotlightId="requests-list"
			/>
		);
	};

	return (
		<Panel {...rest}>
			<Header
				title={$L('My Requests')}
				onClose={onClose}
				type="compact"
			/>
			<TabLayout
				onSelect={handleTabSelect}
			>
				<Tab title={$L('All')}>
					{renderContent()}
				</Tab>
				<Tab title={$L('Pending')}>
					{renderContent()}
				</Tab>
				<Tab title={$L('Approved')}>
					{renderContent()}
				</Tab>
				<Tab title={$L('Available')}>
					{renderContent()}
				</Tab>
			</TabLayout>
		</Panel>
	);
};

export default JellyseerrRequests;
