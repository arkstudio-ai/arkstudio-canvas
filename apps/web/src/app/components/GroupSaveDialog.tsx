/**
 * 编组保存对话框（开源版）。
 *
 * 由 useGroupSave hook 触发：用户在 GroupNode 上点保存图标后弹出，填名称
 * 描述和标签后调 templatesService.create。
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
import type { TemplateTag } from '../services/templatesService';

export interface GroupSaveDialogPayload {
  name: string;
  description: string;
  tags: TemplateTag[];
  cover?: string;
}

interface GroupSaveDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: GroupSaveDialogPayload) => void | Promise<void>;
  saving?: boolean;
}

const TAG_CATEGORIES = [
  { label: '类型', value: 'type' },
  { label: '行业', value: 'industry' },
  { label: '模型', value: 'model' },
  { label: '其他', value: 'tag' },
];

export function GroupSaveDialog({ open, onClose, onConfirm, saving }: GroupSaveDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<TemplateTag[]>([]);
  const [tagCategory, setTagCategory] = useState('type');
  const [tagValue, setTagValue] = useState('');
  const [cover, setCover] = useState('');
  const [uploading, setUploading] = useState(false);

  const coverInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setName('');
    setDescription('');
    setTags([]);
    setCover('');
    setTagValue('');
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

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

  const handleUploadCover = async (file: File) => {
    setUploading(true);
    try {
      const res: any = await api.uploadFile(file);
      let url = '';
      if (typeof res === 'string') url = res;
      else if (typeof res?.data?.file_url === 'string') url = res.data.file_url;
      else if (typeof res?.data === 'string') url = res.data;

      if (url && url.startsWith('http')) {
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

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('请输入模板名称');
      return;
    }
    if (name.length > 25) {
      toast.error('模板名称不能超过 25 字');
      return;
    }
    await onConfirm({
      name: name.trim(),
      description: description.trim(),
      tags,
      cover: cover || undefined,
    });
    reset();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Content style={{ maxWidth: 500 }}>
        <Dialog.Title>保存为模板</Dialog.Title>

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
              onChange={(e) => setName(e.target.value.slice(0, 25))}
              placeholder="请输入模板名称..."
              maxLength={25}
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
                <Text size="1" color="green">
                  已上传
                </Text>
              )}
            </Flex>
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
                    onClick={() => setTags(tags.filter((_, idx) => idx !== i))}
                  />
                </Badge>
              ))}
            </Flex>
          </Flex>

          <Flex gap="3" mt="4" justify="end">
            <Button variant="soft" color="gray" onClick={handleClose} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? <Spinner /> : '保存'}
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
