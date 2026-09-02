// Re-exported from the shared domain layer so extractors keep their local,
// dependency-free error import while the application service catches the same
// class from one canonical location.
export { AttachmentExtractionError } from '../../context/attachment/attachmentErrors';
