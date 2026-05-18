/**
 * 模板编辑对话框（开源版）。
 *
 * 商业版 FlowGroupEditDialog 含 isPublic 切换、发布请求等字段，开源版统一删掉。
 * 这里只保留：name / description / cover（可上传）/ tags 增删。
 */
import { useRef, useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  Flex,
  IconButton,
  SegmentedControl,
  Spinner,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import { Cross2Icon, PlusIcon, UploadIcon } from '@radix-ui/react-icons';
import { toast } from 'sonner';
import { api } from '../services/api';
import {
  templatesService,
  type TemplateAsset,
  type TemplateTag,
} from '../services/templatesService';

interface TemplateEditDialogProps {
  asset: TemplateAsset;
  onClose: () => void;
  onSave: () => void;
}

const TAG_CATEGORIES = [
  { label: '类型', value: 'type' },
  { label: '行业', value: 'industry' },
  { label: '模型', value: 'model' },
  { label: '其他', value: 'tag' },
];

export function TemplateEditDialog({ asset, onClose, onSave }: TemplateEditDialogProps) {
  const [name, setName] = useState(asset.name);
  const [description, setDescription] = useState(asset.description || '');
  const [cover, setCover] = useState(asset.cover || '');
  const [tags, setTags] = useState<TemplateTag[]>(asset.tags || []);
  const [tagCategory, setTagCategory] = useState('type');
  const [tagValue, setTagValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const coverInputRef = useRef<HTMLInputElement>(null);

  const handleAddTag = () => {
    const trimmed = tagValue.trim();
    if (!trimmed) return;
    if (tags.some((t) => t.category === tagCategory && t.value === trimmed)) {
      setTagValue('');
      return;
    }
    setTags([...tags, { category: tagCategory, value: trimmed }]);
    setTagValue('');
  };

  const handleRemoveTag = (idx: number) => {
    setTags(tags.filter((_, i) => i !== idx));
  };

  const handleUploadCover = async (file: File) => {
    setUploading(true);
    try {
      // 同 GroupSaveDialog 注释: api.uploadFile 现在返 string ('/static/
      // uploads/<key>'); 历史的 url.startsWith('http') 把相对路径误判失败,
      // 移除.
      const url = await api.uploadFile(file);
      if (url) {
        setCover(url);
        toast.success('封面已上传');
      } else {
        toast.error('封面上传未返回有效链接');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '封面上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('请输入模板名称');
      return;
    }
    setSaving(true);
    try {
      const originalTagKeys = new Set(asset.tags.map((t) => `${t.category}:${t.value}`));
      const currentTagKeys = new Set(tags.map((t) => `${t.category}:${t.value}`));
      const addTags = tags.filter((t) => !originalTagKeys.has(`${t.category}:${t.value}`));
      const removeTags = asset.tags.filter((t) => !currentTagKeys.has(`${t.category}:${t.value}`));

      await templatesService.update(asset.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        cover: cover || undefined,
        addTags: addTags.length ? addTags : undefined,
        removeTags: removeTags.length ? removeTags : undefined,
      });

      toast.success('模板已更新');
      onSave();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content style={{ maxWidth: 500 }}>
        <Dialog.Title>编辑模板</Dialog.Title>

        <Flex direction="column" gap="4">
          <Flex direction="column" gap="2">
            <Flex justify="between" align="center">
              <Text size="2" color="gray">
                名称
              </Text>
              <Text size="1" color={name.length > 25 ? 'red' : 'gray'}>
                {name.length}/25
              </Text>
            </Flex>
            <TextField.Root
              value={name}
              maxLength={25}
              onChange={(e) => setName(e.target.value.slice(0, 25))}
              placeholder="请输入模板名称..."
            />
          </Flex>

          <Flex direction="column" gap="2">
            <Text size="2" color="gray">
              描述
            </Text>
            <TextArea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="请输入描述..."
              style={{ height: 80, resize: 'none' }}
            />
          </Flex>

          <Flex direction="column" gap="2">
            <Text size="2" color="gray">
              封面 (可选)
            </Text>
            <Flex align="center" gap="2">
              <Button variant="soft" onClick={() => coverInputRef.current?.click()} disabled={uploading}>
                {uploading ? <Spinner /> : <UploadIcon />}
                {cover ? '更换封面' : '上传封面'}
              </Button>
              <input
                type="file"
                hidden
                ref={coverInputRef}
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUploadCover(file);
                  if (e.target) e.target.value = '';
                }}
              />
              {cover && (
                <Text size="1" color="green" style={{ wordBreak: 'break-all' }}>
                  已上传
                </Text>
              )}
            </Flex>
            {cover && (
              <img
                src={cover}
                alt="cover"
                style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8 }}
              />
            )}
          </Flex>

          <Flex direction="column" gap="3">
            <Text size="2" color="gray">
              标签
            </Text>
            <Flex align="center" gap="3">
              <Text size="2" color="gray">
                分类:
              </Text>
              <SegmentedControl.Root value={tagCategory} onValueChange={setTagCategory}>
                {TAG_CATEGORIES.map((cat) => (
                  <SegmentedControl.Item key={cat.value} value={cat.value}>
                    {cat.label}
                  </SegmentedControl.Item>
                ))}
              </SegmentedControl.Root>
            </Flex>
            <Flex gap="2">
              <TextField.Root
                style={{ flex: 1 }}
                value={tagValue}
                onChange={(e) => setTagValue(e.target.value)}
                placeholder="标签值"
                onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
              />
              <IconButton onClick={handleAddTag} variant="soft">
                <PlusIcon />
              </IconButton>
            </Flex>
            <Flex wrap="wrap" gap="2">
              {tags.map((tag, i) => (
                <Badge key={`${tag.category}:${tag.value}`} size="2" variant="solid" color="indigo">
                  {TAG_CATEGORIES.find((c) => c.value === tag.category)?.label || tag.category}: {tag.value}
                  <Cross2Icon
                    style={{ marginLeft: 4, cursor: 'pointer' }}
                    onClick={() => handleRemoveTag(i)}
                  />
                </Badge>
              ))}
            </Flex>
          </Flex>

          <Flex gap="3" mt="4" justify="end">
            <Button variant="soft" color="gray" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Spinner /> : '保存'}
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
