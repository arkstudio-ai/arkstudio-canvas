/**
 * 画布编辑对话框（开源版）。
 *
 * 改名 / 改描述 / 改封面。Cover 走 api.uploadFile 上传，跟 TemplateEditDialog
 * 同套路径。
 */
import { useRef, useState } from 'react';
import { Button, Dialog, Flex, Spinner, Text, TextArea, TextField } from '@radix-ui/themes';
import { UploadIcon } from '@radix-ui/react-icons';
import { toast } from 'sonner';
import { api } from '../services/api';
import { canvasService, type CanvasItem } from '../services/canvasService';

interface CanvasEditDialogProps {
  canvas: CanvasItem;
  onClose: () => void;
  onSave: () => void;
}

export function CanvasEditDialog({ canvas, onClose, onSave }: CanvasEditDialogProps) {
  const [name, setName] = useState(canvas.name);
  const [description, setDescription] = useState(canvas.description || '');
  const [cover, setCover] = useState(canvas.cover || '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const coverInputRef = useRef<HTMLInputElement>(null);

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

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('请输入画布名称');
      return;
    }
    setSaving(true);
    try {
      await canvasService.updateCanvas(canvas.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        cover: cover || undefined,
      });
      toast.success('画布已更新');
      onSave();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content style={{ maxWidth: 480 }}>
        <Dialog.Title>编辑画布</Dialog.Title>

        <Flex direction="column" gap="4">
          <Flex direction="column" gap="2">
            <Text size="2" color="gray">
              名称
            </Text>
            <TextField.Root
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入画布名称..."
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
              <Button
                variant="soft"
                onClick={() => coverInputRef.current?.click()}
                disabled={uploading}
              >
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
            {cover && (
              <img
                src={cover}
                alt="cover"
                style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8 }}
              />
            )}
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
